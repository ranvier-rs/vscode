import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EnvironmentStore, interpolateVariables } from './core/environment-store';

// ── Proto Parsing Types ───────────────────────────────────────────

type ProtoField = {
    name: string;
    type: string;
    number: number;
    repeated: boolean;
    optional: boolean;
    mapKeyType?: string;
    mapValueType?: string;
};

type ProtoMessage = {
    name: string;
    fullName: string;
    fields: ProtoField[];
    nestedMessages: ProtoMessage[];
    nestedEnums: ProtoEnum[];
};

type ProtoEnumValue = {
    name: string;
    number: number;
};

type ProtoEnum = {
    name: string;
    fullName: string;
    values: ProtoEnumValue[];
};

type ProtoMethod = {
    name: string;
    inputType: string;
    outputType: string;
    clientStreaming: boolean;
    serverStreaming: boolean;
};

type ProtoService = {
    name: string;
    fullName: string;
    methods: ProtoMethod[];
};

type ProtoFile = {
    fileName: string;
    packageName: string;
    syntax: string;
    services: ProtoService[];
    messages: ProtoMessage[];
    enums: ProtoEnum[];
    imports: string[];
};

// ── Regex-based Proto Parser ──────────────────────────────────────

function parseProtoFile(content: string, fileName: string): ProtoFile {
    const result: ProtoFile = {
        fileName,
        packageName: '',
        syntax: 'proto3',
        services: [],
        messages: [],
        enums: [],
        imports: [],
    };

    // Strip single-line and multi-line comments
    const stripped = content
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    // Syntax
    const syntaxMatch = stripped.match(/syntax\s*=\s*"([^"]+)"/);
    if (syntaxMatch) {
        result.syntax = syntaxMatch[1]!;
    }

    // Package
    const packageMatch = stripped.match(/package\s+([\w.]+)\s*;/);
    if (packageMatch) {
        result.packageName = packageMatch[1]!;
    }

    // Imports
    const importRegex = /import\s+"([^"]+)"\s*;/g;
    let importMatch;
    while ((importMatch = importRegex.exec(stripped)) !== null) {
        result.imports.push(importMatch[1]!);
    }

    // Parse top-level messages
    result.messages = parseMessages(stripped, result.packageName);

    // Parse top-level enums
    result.enums = parseEnums(stripped, result.packageName);

    // Parse services
    result.services = parseServices(stripped, result.packageName);

    return result;
}

function parseMessages(content: string, prefix: string): ProtoMessage[] {
    const messages: ProtoMessage[] = [];
    const messageRegex = /\bmessage\s+(\w+)\s*\{/g;
    let match;

    while ((match = messageRegex.exec(content)) !== null) {
        const name = match[1]!;
        const fullName = prefix ? `${prefix}.${name}` : name;
        const startIdx = match.index + match[0].length;
        const body = extractBraceBlock(content, startIdx);
        if (body === null) continue;

        const fields = parseFields(body);
        const nestedMessages = parseMessages(body, fullName);
        const nestedEnums = parseEnums(body, fullName);

        messages.push({ name, fullName, fields, nestedMessages, nestedEnums });
    }

    return messages;
}

function parseFields(body: string): ProtoField[] {
    const fields: ProtoField[] = [];

    // Map fields: map<KeyType, ValueType> field_name = N;
    const mapRegex = /map\s*<\s*(\w+)\s*,\s*(\w+)\s*>\s+(\w+)\s*=\s*(\d+)/g;
    let mapMatch;
    while ((mapMatch = mapRegex.exec(body)) !== null) {
        fields.push({
            name: mapMatch[3]!,
            type: `map<${mapMatch[1]}, ${mapMatch[2]}>`,
            number: parseInt(mapMatch[4]!, 10),
            repeated: false,
            optional: false,
            mapKeyType: mapMatch[1]!,
            mapValueType: mapMatch[2]!,
        });
    }

    // Regular fields: [optional|repeated] type name = N;
    const fieldRegex = /(?:^|\n)\s*(optional\s+|repeated\s+)?(\w+(?:\.\w+)*)\s+(\w+)\s*=\s*(\d+)/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
        const qualifier = (fieldMatch[1] ?? '').trim();
        const typeName = fieldMatch[2]!;
        const fieldName = fieldMatch[3]!;
        const fieldNumber = parseInt(fieldMatch[4]!, 10);

        // Skip if it looks like a map (already parsed)
        if (typeName === 'map') continue;
        // Skip nested message/enum/service definitions
        if (['message', 'enum', 'service', 'oneof', 'reserved', 'option', 'extensions'].includes(typeName)) continue;

        fields.push({
            name: fieldName,
            type: typeName,
            number: fieldNumber,
            repeated: qualifier === 'repeated',
            optional: qualifier === 'optional',
        });
    }

    return fields.sort((a, b) => a.number - b.number);
}

function parseEnums(content: string, prefix: string): ProtoEnum[] {
    const enums: ProtoEnum[] = [];
    const enumRegex = /\benum\s+(\w+)\s*\{/g;
    let match;

    while ((match = enumRegex.exec(content)) !== null) {
        const name = match[1]!;
        const fullName = prefix ? `${prefix}.${name}` : name;
        const startIdx = match.index + match[0].length;
        const body = extractBraceBlock(content, startIdx);
        if (body === null) continue;

        const values: ProtoEnumValue[] = [];
        const valueRegex = /(\w+)\s*=\s*(-?\d+)/g;
        let valueMatch;
        while ((valueMatch = valueRegex.exec(body)) !== null) {
            values.push({
                name: valueMatch[1]!,
                number: parseInt(valueMatch[2]!, 10),
            });
        }

        enums.push({ name, fullName, values });
    }

    return enums;
}

function parseServices(content: string, prefix: string): ProtoService[] {
    const services: ProtoService[] = [];
    const serviceRegex = /\bservice\s+(\w+)\s*\{/g;
    let match;

    while ((match = serviceRegex.exec(content)) !== null) {
        const name = match[1]!;
        const fullName = prefix ? `${prefix}.${name}` : name;
        const startIdx = match.index + match[0].length;
        const body = extractBraceBlock(content, startIdx);
        if (body === null) continue;

        const methods: ProtoMethod[] = [];
        const rpcRegex = /rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+(?:\.\w+)*)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+(?:\.\w+)*)\s*\)/g;
        let rpcMatch;
        while ((rpcMatch = rpcRegex.exec(body)) !== null) {
            methods.push({
                name: rpcMatch[1]!,
                inputType: rpcMatch[3]!,
                outputType: rpcMatch[5]!,
                clientStreaming: Boolean(rpcMatch[2]),
                serverStreaming: Boolean(rpcMatch[4]),
            });
        }

        services.push({ name, fullName, methods });
    }

    return services;
}

function extractBraceBlock(content: string, startAfterOpenBrace: number): string | null {
    let depth = 1;
    let i = startAfterOpenBrace;
    while (i < content.length && depth > 0) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') depth--;
        i++;
    }
    if (depth !== 0) return null;
    return content.slice(startAfterOpenBrace, i - 1);
}

// ── gRPC Call Log Entry ───────────────────────────────────────────

type GrpcLogEntry = {
    id: string;
    direction: 'sent' | 'received' | 'error' | 'status';
    data: string;
    timestamp: string;
};

// ── Panel class ───────────────────────────────────────────────────

export class GrpcExplorerPanel {
    public static currentPanel: GrpcExplorerPanel | undefined;
    private static readonly viewType = 'ranvierGrpcExplorer';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _workspaceRoot?: string;
    private _disposables: vscode.Disposable[] = [];
    private _protoFile: ProtoFile | null = null;
    private _environmentStore?: EnvironmentStore;
    private _activeEnvironment?: string;
    private _environmentVariables: Record<string, string> = {};
    private _callLog: GrpcLogEntry[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        workspaceRoot?: string,
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (GrpcExplorerPanel.currentPanel) {
            GrpcExplorerPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            GrpcExplorerPanel.viewType,
            'Ranvier: gRPC Explorer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            },
        );

        GrpcExplorerPanel.currentPanel = new GrpcExplorerPanel(
            panel,
            extensionUri,
            workspaceRoot,
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        workspaceRoot?: string,
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._workspaceRoot = workspaceRoot;

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'load-proto-file':
                        await this._handleLoadProtoFile();
                        break;
                    case 'load-proto-from-path':
                        await this._handleLoadProtoFromPath(message.payload.path);
                        break;
                    case 'execute-call':
                        await this._handleExecuteCall(message.payload);
                        break;
                    case 'load-environments':
                        await this._handleLoadEnvironments();
                        break;
                    case 'switch-environment':
                        await this._handleSwitchEnvironment(message.payload.name);
                        break;
                }
            },
            null,
            this._disposables,
        );
    }

    public dispose(): void {
        GrpcExplorerPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }

    // ── Environment helpers ───────────────────────────────────────

    private _ensureEnvironmentStore(): EnvironmentStore | undefined {
        if (!this._environmentStore && this._workspaceRoot) {
            this._environmentStore = new EnvironmentStore(this._workspaceRoot);
        }
        return this._environmentStore;
    }

    private _interpolate(value: string): string {
        if (Object.keys(this._environmentVariables).length === 0) return value;
        return interpolateVariables(value, this._environmentVariables);
    }

    // ── Message handlers ──────────────────────────────────────────

    private async _handleLoadProtoFile(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            filters: { 'Proto Files': ['proto'] },
            openLabel: 'Load Proto File',
        });

        if (!uris || uris.length === 0) return;
        const uri = uris[0];
        if (!uri) return;

        await this._parseAndSendProto(uri.fsPath);
    }

    private async _handleLoadProtoFromPath(protoPath: string): Promise<void> {
        // Resolve relative paths from workspace root
        let resolvedPath = protoPath;
        if (!path.isAbsolute(protoPath) && this._workspaceRoot) {
            resolvedPath = path.join(this._workspaceRoot, protoPath);
        }
        await this._parseAndSendProto(resolvedPath);
    }

    private async _parseAndSendProto(filePath: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const fileName = path.basename(filePath);
            this._protoFile = parseProtoFile(content, fileName);

            const tree = this._buildServiceTree(this._protoFile);

            this._postMessage({
                type: 'proto-loaded',
                payload: {
                    fileName: this._protoFile.fileName,
                    packageName: this._protoFile.packageName,
                    syntax: this._protoFile.syntax,
                    serviceCount: this._protoFile.services.length,
                    messageCount: this._protoFile.messages.length,
                    enumCount: this._protoFile.enums.length,
                    tree,
                },
            });
        } catch (e: any) {
            this._postMessage({
                type: 'proto-error',
                payload: { message: e?.message || 'Failed to load proto file' },
            });
        }
    }

    private async _handleExecuteCall(payload: {
        serverAddress: string;
        serviceName: string;
        methodName: string;
        requestBody: string;
        metadata: string;
    }): Promise<void> {
        const resolvedAddress = this._interpolate(payload.serverAddress);
        const start = Date.now();

        let parsedBody: unknown;
        try {
            parsedBody = JSON.parse(payload.requestBody);
        } catch {
            this._postMessage({
                type: 'call-error',
                payload: { message: 'Invalid JSON in request body.' },
            });
            return;
        }

        let parsedMetadata: Record<string, string> = {};
        if (payload.metadata.trim()) {
            try {
                parsedMetadata = JSON.parse(payload.metadata);
            } catch {
                this._postMessage({
                    type: 'call-error',
                    payload: { message: 'Invalid JSON in metadata editor.' },
                });
                return;
            }
        }

        // Find the method definition
        const method = this._findMethod(payload.serviceName, payload.methodName);
        if (!method) {
            this._postMessage({
                type: 'call-error',
                payload: { message: `Method ${payload.serviceName}/${payload.methodName} not found in proto definition.` },
            });
            return;
        }

        // Add sent entry to call log
        const sentEntry: GrpcLogEntry = {
            id: `${Date.now()}-sent`,
            direction: 'sent',
            data: JSON.stringify(parsedBody, null, 2),
            timestamp: new Date().toISOString(),
        };
        this._callLog.push(sentEntry);
        this._postMessage({ type: 'call-log-entry', payload: sentEntry });

        // Attempt HTTP/2 gRPC-Web call (best-effort placeholder).
        // Real gRPC requires native HTTP/2 framing and protobuf serialization,
        // which is not available in the VS Code extension host without native
        // modules. This implementation sends a gRPC-Web-compatible HTTP request
        // that works with gRPC-Web proxies (e.g., Envoy, grpc-web).
        try {
            const url = `${resolvedAddress.replace(/\/$/, '')}/${payload.serviceName}/${payload.methodName}`;

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'X-Grpc-Web': '1',
                ...parsedMetadata,
            };

            // Apply environment interpolation to metadata values
            for (const [k, v] of Object.entries(headers)) {
                headers[k] = this._interpolate(v);
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(parsedBody),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            const durationMs = Date.now() - start;
            const contentType = response.headers.get('content-type') || '';
            let responseBody: unknown;

            if (contentType.includes('application/json')) {
                responseBody = await response.json();
            } else {
                responseBody = await response.text();
            }

            // Extract gRPC status from headers if present
            const grpcStatus = response.headers.get('grpc-status') ?? (response.ok ? '0' : '2');
            const grpcMessage = response.headers.get('grpc-message') ?? '';

            const receivedEntry: GrpcLogEntry = {
                id: `${Date.now()}-recv`,
                direction: 'received',
                data: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody, null, 2),
                timestamp: new Date().toISOString(),
            };
            this._callLog.push(receivedEntry);
            this._postMessage({ type: 'call-log-entry', payload: receivedEntry });

            const statusEntry: GrpcLogEntry = {
                id: `${Date.now()}-status`,
                direction: 'status',
                data: `gRPC status: ${grpcStatus}${grpcMessage ? ` (${grpcMessage})` : ''} | HTTP ${response.status} | ${durationMs}ms`,
                timestamp: new Date().toISOString(),
            };
            this._callLog.push(statusEntry);
            this._postMessage({ type: 'call-log-entry', payload: statusEntry });

            this._postMessage({
                type: 'call-result',
                payload: {
                    status: response.status,
                    grpcStatus: parseInt(grpcStatus, 10),
                    grpcMessage,
                    body: responseBody,
                    durationMs,
                    streaming: method.serverStreaming,
                },
            });
        } catch (e: any) {
            const durationMs = Date.now() - start;
            const errorEntry: GrpcLogEntry = {
                id: `${Date.now()}-err`,
                direction: 'error',
                data: e?.message || 'Call failed',
                timestamp: new Date().toISOString(),
            };
            this._callLog.push(errorEntry);
            this._postMessage({ type: 'call-log-entry', payload: errorEntry });

            this._postMessage({
                type: 'call-error',
                payload: {
                    message: e?.message || 'gRPC call failed',
                    durationMs,
                },
            });
        }
    }

    private _findMethod(serviceName: string, methodName: string): ProtoMethod | undefined {
        if (!this._protoFile) return undefined;
        const service = this._protoFile.services.find(
            (s) => s.name === serviceName || s.fullName === serviceName,
        );
        if (!service) return undefined;
        return service.methods.find((m) => m.name === methodName);
    }

    private async _handleLoadEnvironments(): Promise<void> {
        const envStore = this._ensureEnvironmentStore();
        if (!envStore) return;
        const environments = await envStore.listEnvironments();
        this._postMessage({
            type: 'environments-loaded',
            payload: { environments, activeEnvironment: this._activeEnvironment },
        });
    }

    private async _handleSwitchEnvironment(name: string): Promise<void> {
        const envStore = this._ensureEnvironmentStore();
        if (!envStore) return;
        this._activeEnvironment = name;
        const env = await envStore.loadEnvironment(name);
        if (env) {
            this._environmentVariables = env.variables;
        }
        await this._handleLoadEnvironments();
    }

    // ── Service tree builder ──────────────────────────────────────

    private _buildServiceTree(proto: ProtoFile): ServiceTreeNode[] {
        const nodes: ServiceTreeNode[] = [];

        // Services
        for (const service of proto.services) {
            const methodNodes: ServiceTreeNode[] = service.methods.map((method) => {
                const streamLabel = [];
                if (method.clientStreaming) streamLabel.push('client-stream');
                if (method.serverStreaming) streamLabel.push('server-stream');
                const suffix = streamLabel.length > 0 ? ` [${streamLabel.join(', ')}]` : '';

                return {
                    label: `${method.name}(${method.inputType}) -> ${method.outputType}${suffix}`,
                    kind: 'method' as const,
                    serviceName: service.name,
                    methodName: method.name,
                    inputType: method.inputType,
                    outputType: method.outputType,
                    clientStreaming: method.clientStreaming,
                    serverStreaming: method.serverStreaming,
                };
            });

            nodes.push({
                label: `service ${service.name}`,
                kind: 'service',
                children: methodNodes,
            });
        }

        // Messages
        if (proto.messages.length > 0) {
            nodes.push({
                label: 'Messages',
                kind: 'category',
                children: proto.messages.map((msg) => this._messageToTreeNode(msg)),
            });
        }

        // Enums
        if (proto.enums.length > 0) {
            nodes.push({
                label: 'Enums',
                kind: 'category',
                children: proto.enums.map((e) => ({
                    label: `enum ${e.name}`,
                    kind: 'enum' as const,
                    children: e.values.map((v) => ({
                        label: `${v.name} = ${v.number}`,
                        kind: 'enum-value' as const,
                    })),
                })),
            });
        }

        return nodes;
    }

    private _messageToTreeNode(msg: ProtoMessage): ServiceTreeNode {
        const children: ServiceTreeNode[] = [];

        for (const field of msg.fields) {
            const prefix = field.repeated ? 'repeated ' : field.optional ? 'optional ' : '';
            children.push({
                label: `${prefix}${field.type} ${field.name} = ${field.number}`,
                kind: 'field',
            });
        }

        for (const nested of msg.nestedMessages) {
            children.push(this._messageToTreeNode(nested));
        }

        for (const nested of msg.nestedEnums) {
            children.push({
                label: `enum ${nested.name}`,
                kind: 'enum',
                children: nested.values.map((v) => ({
                    label: `${v.name} = ${v.number}`,
                    kind: 'enum-value' as const,
                })),
            });
        }

        return {
            label: `message ${msg.name}`,
            kind: 'message',
            children: children.length > 0 ? children : undefined,
        };
    }

    // ── Post message helper ───────────────────────────────────────

    private _postMessage(message: unknown): void {
        void this._panel.webview.postMessage(message);
    }

    // ── HTML generation ───────────────────────────────────────────

    private _getHtmlForWebview(): string {
        const nonce = getNonce();
        const webview = this._panel.webview;
        const cspSource = webview.cspSource;

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src *;">
    <title>gRPC Explorer</title>
    <style nonce="${nonce}">
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --btn-bg: var(--vscode-button-background);
            --btn-fg: var(--vscode-button-foreground);
            --btn-hover: var(--vscode-button-hoverBackground);
            --border: var(--vscode-panel-border, #444);
            --success: var(--vscode-testing-iconPassed, #4caf50);
            --error: var(--vscode-testing-iconFailed, #f44336);
            --warning: var(--vscode-editorWarning-foreground, #ff9800);
            --muted: var(--vscode-descriptionForeground, #888);
            --focus: var(--vscode-focusBorder, #007fd4);
            --tree-indent: 16px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); padding: 12px; }
        h2 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
        h3 { font-size: 13px; font-weight: 600; margin: 12px 0 6px 0; }

        .toolbar { display: flex; gap: 6px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
        .toolbar input { flex: 1; min-width: 150px; padding: 5px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 12px; }
        .toolbar input:focus { outline: none; border-color: var(--focus); }
        .toolbar select { padding: 5px 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 12px; }

        button { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; }
        button:hover { background: var(--btn-hover); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.secondary { background: transparent; border: 1px solid var(--border); color: var(--fg); }
        button.secondary:hover { background: var(--input-bg); }

        .split { display: flex; gap: 12px; height: calc(100vh - 200px); min-height: 400px; }
        .left-panel { width: 280px; min-width: 220px; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--border); padding-right: 12px; }
        .right-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        .service-tree { flex: 1; overflow-y: auto; font-size: 12px; }
        .tree-node { cursor: pointer; padding: 2px 0; user-select: none; }
        .tree-node:hover { background: var(--input-bg); }
        .tree-label { display: inline-flex; align-items: center; gap: 4px; }
        .tree-icon { width: 14px; text-align: center; font-size: 10px; color: var(--muted); }
        .tree-children { padding-left: var(--tree-indent); }
        .tree-category { font-weight: 600; color: var(--fg); }
        .tree-service { color: var(--warning); font-weight: 600; }
        .tree-method { color: var(--success); cursor: pointer; }
        .tree-method:hover { text-decoration: underline; }
        .tree-field { color: var(--fg); }
        .tree-message { color: var(--focus); }

        .call-section { display: flex; flex-direction: column; gap: 8px; flex: 1; overflow: hidden; }
        .call-section label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }

        textarea { width: 100%; padding: 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; resize: none; tab-size: 2; }
        textarea:focus { outline: none; border-color: var(--focus); }

        .request-body-editor { flex: 1; min-height: 100px; }
        .metadata-editor { height: 60px; }

        .call-log { flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--border); border-radius: 3px; padding: 8px; background: var(--input-bg); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
        .log-entry { margin-bottom: 6px; padding: 4px 6px; border-radius: 2px; border-left: 3px solid var(--border); }
        .log-entry.sent { border-left-color: var(--success); }
        .log-entry.received { border-left-color: var(--focus); }
        .log-entry.error { border-left-color: var(--error); }
        .log-entry.status { border-left-color: var(--warning); }
        .log-direction { font-size: 10px; font-weight: 600; text-transform: uppercase; margin-bottom: 2px; }
        .log-direction.sent { color: var(--success); }
        .log-direction.received { color: var(--focus); }
        .log-direction.error { color: var(--error); }
        .log-direction.status { color: var(--warning); }
        .log-timestamp { font-size: 10px; color: var(--muted); float: right; }
        .log-data { white-space: pre-wrap; word-break: break-word; margin-top: 2px; }

        .response-panel { margin-top: 8px; }
        .response-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .status-badge { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
        .status-badge.success { background: var(--success); color: #fff; }
        .status-badge.error { background: var(--error); color: #fff; }

        .method-info { padding: 8px; background: var(--input-bg); border: 1px solid var(--border); border-radius: 3px; font-size: 12px; margin-bottom: 8px; }
        .method-info .label { color: var(--muted); font-size: 11px; }

        .status-bar { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 11px; color: var(--muted); border-top: 1px solid var(--border); margin-top: 8px; }

        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: var(--muted); text-align: center; }
        .empty-state p { margin: 4px 0; }

        .note-banner { padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--warning); border-radius: 3px; font-size: 11px; color: var(--fg); margin-bottom: 12px; }
        .note-banner strong { color: var(--warning); }
    </style>
</head>
<body>
    <h2>gRPC Explorer</h2>

    <div class="note-banner">
        <strong>Note:</strong> gRPC calls are sent as HTTP/1.1 JSON requests compatible with gRPC-Web proxies (e.g., Envoy).
        Native HTTP/2 gRPC requires a native module not available in the VS Code extension host.
    </div>

    <div class="toolbar">
        <input type="text" id="serverAddress" placeholder="Server address (e.g., http://localhost:50051)" value="http://localhost:50051" />
        <button id="btnLoadProto">Load .proto File</button>
        <select id="envSelect" title="Environment">
            <option value="">No Environment</option>
        </select>
    </div>

    <div class="split">
        <div class="left-panel">
            <h3>Services & Messages</h3>
            <div class="service-tree" id="serviceTree">
                <div class="empty-state">
                    <p>No proto file loaded.</p>
                    <p>Click "Load .proto File" to begin.</p>
                </div>
            </div>
        </div>

        <div class="right-panel">
            <div class="method-info" id="methodInfo" style="display:none;">
                <span class="label">Method:</span> <strong id="methodLabel"></strong><br/>
                <span class="label">Input:</span> <span id="methodInput"></span> |
                <span class="label">Output:</span> <span id="methodOutput"></span>
            </div>

            <div class="call-section">
                <div style="display:flex; flex-direction:column; flex:1; min-height:0;">
                    <label>Request Body (JSON)</label>
                    <textarea id="requestBody" class="request-body-editor" placeholder="{}"></textarea>
                </div>

                <div>
                    <label>Metadata (JSON key-value pairs)</label>
                    <textarea id="metadataEditor" class="metadata-editor" placeholder='{"authorization": "Bearer token"}'></textarea>
                </div>

                <div class="toolbar" style="margin-bottom:0;">
                    <select id="serviceSelect" style="min-width:120px;">
                        <option value="">Select service</option>
                    </select>
                    <select id="methodSelect" style="min-width:120px;">
                        <option value="">Select method</option>
                    </select>
                    <button id="btnExecute" disabled>Execute Call</button>
                </div>

                <h3>Call Log</h3>
                <div class="call-log" id="callLog">
                    <span style="color:var(--muted);">Call log will appear here after executing a gRPC call.</span>
                </div>
            </div>
        </div>
    </div>

    <div class="status-bar" id="statusBar">
        <span id="statusText">Ready</span>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        const serverAddress = document.getElementById('serverAddress');
        const btnLoadProto = document.getElementById('btnLoadProto');
        const btnExecute = document.getElementById('btnExecute');
        const serviceTree = document.getElementById('serviceTree');
        const requestBody = document.getElementById('requestBody');
        const metadataEditor = document.getElementById('metadataEditor');
        const callLog = document.getElementById('callLog');
        const statusText = document.getElementById('statusText');
        const envSelect = document.getElementById('envSelect');
        const serviceSelect = document.getElementById('serviceSelect');
        const methodSelect = document.getElementById('methodSelect');
        const methodInfo = document.getElementById('methodInfo');
        const methodLabel = document.getElementById('methodLabel');
        const methodInput = document.getElementById('methodInput');
        const methodOutput = document.getElementById('methodOutput');

        let protoData = null;
        let firstLogEntry = true;

        btnLoadProto.addEventListener('click', () => {
            vscode.postMessage({ type: 'load-proto-file' });
        });

        btnExecute.addEventListener('click', () => {
            const svc = serviceSelect.value;
            const mtd = methodSelect.value;
            if (!svc || !mtd) return;
            btnExecute.disabled = true;
            statusText.textContent = 'Executing call...';
            vscode.postMessage({
                type: 'execute-call',
                payload: {
                    serverAddress: serverAddress.value,
                    serviceName: svc,
                    methodName: mtd,
                    requestBody: requestBody.value || '{}',
                    metadata: metadataEditor.value || '{}',
                },
            });
        });

        serviceSelect.addEventListener('change', () => {
            updateMethodSelect();
        });

        methodSelect.addEventListener('change', () => {
            updateMethodInfo();
        });

        envSelect.addEventListener('change', () => {
            const name = envSelect.value;
            if (name) {
                vscode.postMessage({ type: 'switch-environment', payload: { name } });
            }
        });

        vscode.postMessage({ type: 'load-environments' });

        function updateMethodSelect() {
            methodSelect.innerHTML = '<option value="">Select method</option>';
            if (!protoData) return;
            const svcName = serviceSelect.value;
            const svc = findService(svcName);
            if (!svc) return;

            for (const child of svc.children || []) {
                if (child.kind === 'method') {
                    const opt = document.createElement('option');
                    opt.value = child.methodName;
                    opt.textContent = child.label;
                    methodSelect.appendChild(opt);
                }
            }
            btnExecute.disabled = true;
            methodInfo.style.display = 'none';
        }

        function updateMethodInfo() {
            const svcName = serviceSelect.value;
            const mtdName = methodSelect.value;
            if (!svcName || !mtdName) {
                btnExecute.disabled = true;
                methodInfo.style.display = 'none';
                return;
            }
            btnExecute.disabled = false;

            const svc = findService(svcName);
            if (!svc) return;
            const method = (svc.children || []).find(c => c.methodName === mtdName);
            if (!method) return;

            methodInfo.style.display = 'block';
            methodLabel.textContent = svcName + '/' + mtdName;
            methodInput.textContent = method.inputType || '?';
            methodOutput.textContent = method.outputType || '?';
        }

        function findService(name) {
            if (!protoData || !protoData.tree) return null;
            return protoData.tree.find(n => n.kind === 'service' && n.label === 'service ' + name);
        }

        // ── Tree rendering ──

        function renderServiceTree(nodes) {
            serviceTree.innerHTML = '';
            if (!nodes || nodes.length === 0) {
                serviceTree.innerHTML = '<div class="empty-state"><p>No services found in proto file.</p></div>';
                return;
            }
            const fragment = document.createDocumentFragment();
            for (const node of nodes) {
                fragment.appendChild(createTreeNode(node));
            }
            serviceTree.appendChild(fragment);
        }

        function createTreeNode(node) {
            const el = document.createElement('div');
            el.className = 'tree-node';

            const label = document.createElement('span');
            label.className = 'tree-label';

            const icon = document.createElement('span');
            icon.className = 'tree-icon';

            if (node.children && node.children.length > 0) {
                icon.textContent = '\\u25B6';
                let expanded = node.kind === 'service';

                const childContainer = document.createElement('div');
                childContainer.className = 'tree-children';
                childContainer.style.display = expanded ? 'block' : 'none';
                if (expanded) icon.textContent = '\\u25BC';

                for (const child of node.children) {
                    childContainer.appendChild(createTreeNode(child));
                }

                label.addEventListener('click', (e) => {
                    e.stopPropagation();
                    expanded = !expanded;
                    childContainer.style.display = expanded ? 'block' : 'none';
                    icon.textContent = expanded ? '\\u25BC' : '\\u25B6';
                });

                label.appendChild(icon);
                const text = document.createElement('span');
                text.className = getTreeClass(node.kind);
                text.textContent = node.label;
                label.appendChild(text);

                el.appendChild(label);
                el.appendChild(childContainer);
            } else {
                icon.textContent = '\\u2022';
                label.appendChild(icon);
                const text = document.createElement('span');
                text.className = getTreeClass(node.kind);
                text.textContent = node.label;

                if (node.kind === 'method') {
                    text.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Auto-select service and method
                        if (node.serviceName) serviceSelect.value = node.serviceName;
                        updateMethodSelect();
                        if (node.methodName) methodSelect.value = node.methodName;
                        updateMethodInfo();
                    });
                }

                label.appendChild(text);
                el.appendChild(label);
            }

            return el;
        }

        function getTreeClass(kind) {
            switch (kind) {
                case 'service': return 'tree-service';
                case 'method': return 'tree-method';
                case 'message': return 'tree-message';
                case 'category': return 'tree-category';
                default: return 'tree-field';
            }
        }

        // ── Call log rendering ──

        function appendLogEntry(entry) {
            if (firstLogEntry) {
                callLog.innerHTML = '';
                firstLogEntry = false;
            }
            const el = document.createElement('div');
            el.className = 'log-entry ' + entry.direction;

            const ts = new Date(entry.timestamp).toLocaleTimeString();
            el.innerHTML =
                '<span class="log-timestamp">' + escapeHtml(ts) + '</span>' +
                '<div class="log-direction ' + entry.direction + '">' + entry.direction.toUpperCase() + '</div>' +
                '<div class="log-data">' + escapeHtml(entry.data) + '</div>';

            callLog.appendChild(el);
            callLog.scrollTop = callLog.scrollHeight;
        }

        // ── Message handling ──

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'proto-loaded': {
                    protoData = msg.payload;
                    renderServiceTree(msg.payload.tree);

                    // Populate service dropdown
                    serviceSelect.innerHTML = '<option value="">Select service</option>';
                    for (const node of msg.payload.tree) {
                        if (node.kind === 'service') {
                            const opt = document.createElement('option');
                            const name = node.label.replace('service ', '');
                            opt.value = name;
                            opt.textContent = name;
                            serviceSelect.appendChild(opt);
                        }
                    }

                    statusText.textContent =
                        'Proto loaded: ' + msg.payload.fileName +
                        ' (' + msg.payload.serviceCount + ' services, ' +
                        msg.payload.messageCount + ' messages)';
                    break;
                }
                case 'proto-error': {
                    statusText.textContent = 'Proto load failed: ' + msg.payload.message;
                    serviceTree.innerHTML = '<div class="empty-state"><p>' + escapeHtml(msg.payload.message) + '</p></div>';
                    break;
                }
                case 'call-result': {
                    btnExecute.disabled = false;
                    statusText.textContent = 'Call completed (gRPC status: ' + msg.payload.grpcStatus + ', ' + msg.payload.durationMs + 'ms)';
                    break;
                }
                case 'call-error': {
                    btnExecute.disabled = false;
                    statusText.textContent = 'Call failed: ' + msg.payload.message;
                    break;
                }
                case 'call-log-entry': {
                    appendLogEntry(msg.payload);
                    break;
                }
                case 'environments-loaded': {
                    envSelect.innerHTML = '<option value="">No Environment</option>';
                    for (const env of msg.payload.environments) {
                        const opt = document.createElement('option');
                        opt.value = env.name;
                        opt.textContent = env.name;
                        if (env.name === msg.payload.activeEnvironment) {
                            opt.selected = true;
                        }
                        envSelect.appendChild(opt);
                    }
                    break;
                }
            }
        });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.appendChild(document.createTextNode(text));
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }
}

// ── Shared helper types ───────────────────────────────────────────

type ServiceTreeNode = {
    label: string;
    kind: string;
    children?: ServiceTreeNode[];
    serviceName?: string;
    methodName?: string;
    inputType?: string;
    outputType?: string;
    clientStreaming?: boolean;
    serverStreaming?: boolean;
};

// ── Utility ───────────────────────────────────────────────────────

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

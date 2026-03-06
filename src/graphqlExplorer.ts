import * as vscode from 'vscode';
import { EnvironmentStore, interpolateVariables } from './core/environment-store';
import { CollectionStore } from './core/collection-store';
import type { CollectionRequest } from './shared/types';

// ── GraphQL Schema Introspection Types ────────────────────────────

type GraphQLType = {
    kind: string;
    name: string | null;
    description?: string | null;
    fields?: GraphQLField[] | null;
    inputFields?: GraphQLInputValue[] | null;
    interfaces?: GraphQLTypeRef[] | null;
    enumValues?: { name: string; description?: string | null }[] | null;
    possibleTypes?: GraphQLTypeRef[] | null;
    ofType?: GraphQLTypeRef | null;
};

type GraphQLTypeRef = {
    kind: string;
    name: string | null;
    ofType?: GraphQLTypeRef | null;
};

type GraphQLField = {
    name: string;
    description?: string | null;
    args: GraphQLInputValue[];
    type: GraphQLTypeRef;
    isDeprecated?: boolean;
    deprecationReason?: string | null;
};

type GraphQLInputValue = {
    name: string;
    description?: string | null;
    type: GraphQLTypeRef;
    defaultValue?: string | null;
};

type GraphQLSchema = {
    queryType: GraphQLTypeRef | null;
    mutationType: GraphQLTypeRef | null;
    subscriptionType: GraphQLTypeRef | null;
    types: GraphQLType[];
    directives?: unknown[];
};

type IntrospectionResult = {
    data?: {
        __schema: GraphQLSchema;
    };
    errors?: { message: string }[];
};

// ── Introspection Query ───────────────────────────────────────────

const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args {
          name
          description
          type {
            kind
            name
            ofType { kind name ofType { kind name ofType { kind name } } }
          }
          defaultValue
        }
        type {
          kind
          name
          ofType { kind name ofType { kind name ofType { kind name } } }
        }
        isDeprecated
        deprecationReason
      }
      inputFields {
        name
        description
        type {
          kind
          name
          ofType { kind name ofType { kind name ofType { kind name } } }
        }
        defaultValue
      }
      interfaces { kind name ofType { kind name } }
      enumValues(includeDeprecated: true) { name description }
      possibleTypes { kind name }
    }
    directives {
      name
      description
      locations
      args {
        name
        description
        type {
          kind
          name
          ofType { kind name ofType { kind name } }
        }
        defaultValue
      }
    }
  }
}`;

// ── Panel class ───────────────────────────────────────────────────

export class GraphQLExplorerPanel {
    public static currentPanel: GraphQLExplorerPanel | undefined;
    private static readonly viewType = 'ranvierGraphqlExplorer';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _workspaceRoot?: string;
    private _disposables: vscode.Disposable[] = [];
    private _schema: GraphQLSchema | null = null;
    private _environmentStore?: EnvironmentStore;
    private _collectionStore?: CollectionStore;
    private _activeEnvironment?: string;
    private _environmentVariables: Record<string, string> = {};

    public static createOrShow(
        extensionUri: vscode.Uri,
        workspaceRoot?: string,
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (GraphQLExplorerPanel.currentPanel) {
            GraphQLExplorerPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            GraphQLExplorerPanel.viewType,
            'Ranvier: GraphQL Explorer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            },
        );

        GraphQLExplorerPanel.currentPanel = new GraphQLExplorerPanel(
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
                    case 'introspect':
                        await this._handleIntrospect(message.payload.url);
                        break;
                    case 'execute-query':
                        await this._handleExecuteQuery(message.payload);
                        break;
                    case 'save-to-collection':
                        await this._handleSaveToCollection(message.payload);
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
        GraphQLExplorerPanel.currentPanel = undefined;
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

    private _ensureCollectionStore(): CollectionStore | undefined {
        if (!this._collectionStore && this._workspaceRoot) {
            this._collectionStore = new CollectionStore(this._workspaceRoot);
        }
        return this._collectionStore;
    }

    private _interpolate(value: string): string {
        if (Object.keys(this._environmentVariables).length === 0) return value;
        return interpolateVariables(value, this._environmentVariables);
    }

    // ── Message handlers ──────────────────────────────────────────

    private async _handleIntrospect(url: string): Promise<void> {
        const resolvedUrl = this._interpolate(url);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const response = await fetch(resolvedUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: INTROSPECTION_QUERY }),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            const result = (await response.json()) as IntrospectionResult;

            if (result.errors && result.errors.length > 0) {
                this._postMessage({
                    type: 'introspection-error',
                    payload: {
                        message: result.errors.map((e) => e.message).join('; '),
                    },
                });
                return;
            }

            if (!result.data?.__schema) {
                this._postMessage({
                    type: 'introspection-error',
                    payload: { message: 'No schema data returned from introspection.' },
                });
                return;
            }

            this._schema = result.data.__schema;
            const schemaTree = this._buildSchemaTree(this._schema);

            this._postMessage({
                type: 'introspection-result',
                payload: {
                    schemaTree,
                    queryTypeName: this._schema.queryType?.name ?? null,
                    mutationTypeName: this._schema.mutationType?.name ?? null,
                    subscriptionTypeName: this._schema.subscriptionType?.name ?? null,
                    typeCount: this._schema.types.filter(
                        (t) => !t.name?.startsWith('__'),
                    ).length,
                },
            });
        } catch (e: any) {
            this._postMessage({
                type: 'introspection-error',
                payload: { message: e?.message || 'Introspection failed' },
            });
        }
    }

    private async _handleExecuteQuery(payload: {
        url: string;
        query: string;
        variables: string;
        operationName?: string;
    }): Promise<void> {
        const resolvedUrl = this._interpolate(payload.url);
        const start = Date.now();

        let parsedVariables: Record<string, unknown> | undefined;
        if (payload.variables.trim()) {
            try {
                parsedVariables = JSON.parse(payload.variables);
            } catch {
                this._postMessage({
                    type: 'query-error',
                    payload: { message: 'Invalid JSON in variables editor.' },
                });
                return;
            }
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const body: Record<string, unknown> = { query: payload.query };
            if (parsedVariables) {
                body.variables = parsedVariables;
            }
            if (payload.operationName) {
                body.operationName = payload.operationName;
            }

            const response = await fetch(resolvedUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            const durationMs = Date.now() - start;
            const responseBody = await response.json();

            this._postMessage({
                type: 'query-result',
                payload: {
                    status: response.status,
                    body: responseBody,
                    durationMs,
                },
            });
        } catch (e: any) {
            this._postMessage({
                type: 'query-error',
                payload: {
                    message: e?.message || 'Query execution failed',
                    durationMs: Date.now() - start,
                },
            });
        }
    }

    private async _handleSaveToCollection(payload: {
        collectionName: string;
        requestName: string;
        url: string;
        query: string;
        variables: string;
    }): Promise<void> {
        const store = this._ensureCollectionStore();
        if (!store) {
            vscode.window.showWarningMessage('No workspace folder open.');
            return;
        }
        if (!store.isInitialized) {
            await store.init();
        }

        let parsedVariables: unknown;
        if (payload.variables.trim()) {
            try {
                parsedVariables = JSON.parse(payload.variables);
            } catch {
                parsedVariables = undefined;
            }
        }

        const request: CollectionRequest = {
            id: `gql-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: payload.requestName || 'GraphQL Query',
            method: 'POST',
            path: payload.url,
            headers: { 'Content-Type': 'application/json' },
            params: {},
            body: {
                query: payload.query,
                ...(parsedVariables ? { variables: parsedVariables } : {}),
            },
            source: 'manual',
        };

        await store.saveRequest(payload.collectionName, request);
        vscode.window.showInformationMessage(
            `Saved GraphQL query "${payload.requestName}" to collection "${payload.collectionName}".`,
        );
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

    // ── Schema tree builder ───────────────────────────────────────

    private _buildSchemaTree(
        schema: GraphQLSchema,
    ): SchemaTreeNode[] {
        const nodes: SchemaTreeNode[] = [];

        // Query type
        if (schema.queryType?.name) {
            const queryType = schema.types.find(
                (t) => t.name === schema.queryType?.name,
            );
            if (queryType) {
                nodes.push(this._typeToTreeNode(queryType, 'query'));
            }
        }

        // Mutation type
        if (schema.mutationType?.name) {
            const mutationType = schema.types.find(
                (t) => t.name === schema.mutationType?.name,
            );
            if (mutationType) {
                nodes.push(this._typeToTreeNode(mutationType, 'mutation'));
            }
        }

        // Subscription type
        if (schema.subscriptionType?.name) {
            const subscriptionType = schema.types.find(
                (t) => t.name === schema.subscriptionType?.name,
            );
            if (subscriptionType) {
                nodes.push(this._typeToTreeNode(subscriptionType, 'subscription'));
            }
        }

        // Custom types (non-introspection types)
        const customTypes = schema.types
            .filter(
                (t) =>
                    t.name &&
                    !t.name.startsWith('__') &&
                    t.name !== schema.queryType?.name &&
                    t.name !== schema.mutationType?.name &&
                    t.name !== schema.subscriptionType?.name &&
                    !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(t.name),
            )
            .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

        if (customTypes.length > 0) {
            nodes.push({
                label: 'Types',
                kind: 'category',
                children: customTypes.map((t) => this._typeToTreeNode(t, 'type')),
            });
        }

        return nodes;
    }

    private _typeToTreeNode(
        type: GraphQLType,
        category: string,
    ): SchemaTreeNode {
        const children: SchemaTreeNode[] = [];

        if (type.fields) {
            for (const field of type.fields) {
                const args =
                    field.args.length > 0
                        ? `(${field.args.map((a) => `${a.name}: ${typeRefToString(a.type)}`).join(', ')})`
                        : '';
                children.push({
                    label: `${field.name}${args}: ${typeRefToString(field.type)}`,
                    kind: 'field',
                    description: field.description ?? undefined,
                    deprecated: field.isDeprecated,
                });
            }
        }

        if (type.inputFields) {
            for (const field of type.inputFields) {
                children.push({
                    label: `${field.name}: ${typeRefToString(field.type)}`,
                    kind: 'input-field',
                    description: field.description ?? undefined,
                });
            }
        }

        if (type.enumValues) {
            for (const val of type.enumValues) {
                children.push({
                    label: val.name,
                    kind: 'enum-value',
                    description: val.description ?? undefined,
                });
            }
        }

        return {
            label: `${category === 'type' ? '' : `${category}: `}${type.name ?? 'unknown'}`,
            kind: category,
            description: type.description ?? undefined,
            children: children.length > 0 ? children : undefined,
            typeName: type.name ?? undefined,
            typeKind: type.kind,
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
    <title>GraphQL Explorer</title>
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
            --muted: var(--vscode-descriptionForeground, #888);
            --focus: var(--vscode-focusBorder, #007fd4);
            --tree-indent: 16px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); padding: 12px; }
        h2 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
        h3 { font-size: 13px; font-weight: 600; margin: 12px 0 6px 0; }

        .toolbar { display: flex; gap: 6px; margin-bottom: 12px; align-items: center; }
        .toolbar input { flex: 1; padding: 5px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 12px; }
        .toolbar input:focus { outline: none; border-color: var(--focus); }
        .toolbar select { padding: 5px 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 12px; }

        button { padding: 5px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; }
        button:hover { background: var(--btn-hover); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.secondary { background: transparent; border: 1px solid var(--border); color: var(--fg); }
        button.secondary:hover { background: var(--input-bg); }

        .split { display: flex; gap: 12px; height: calc(100vh - 160px); min-height: 400px; }
        .left-panel { width: 260px; min-width: 200px; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--border); padding-right: 12px; }
        .right-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        .schema-tree { flex: 1; overflow-y: auto; font-size: 12px; }
        .tree-node { cursor: pointer; padding: 2px 0; user-select: none; }
        .tree-node:hover { background: var(--input-bg); }
        .tree-label { display: inline-flex; align-items: center; gap: 4px; }
        .tree-icon { width: 14px; text-align: center; font-size: 10px; color: var(--muted); }
        .tree-children { padding-left: var(--tree-indent); }
        .tree-category { font-weight: 600; color: var(--fg); }
        .tree-field { color: var(--fg); }
        .tree-deprecated { text-decoration: line-through; opacity: 0.6; }
        .tree-description { color: var(--muted); font-size: 11px; margin-left: 8px; }

        .editor-area { display: flex; flex-direction: column; gap: 8px; flex: 1; overflow: hidden; }
        .editor-section { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .editor-section.variables { max-height: 120px; flex: 0 0 auto; }
        .editor-section label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }

        textarea { width: 100%; flex: 1; padding: 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; resize: none; tab-size: 2; }
        textarea:focus { outline: none; border-color: var(--focus); }
        textarea.variables-editor { height: 60px; flex: none; }

        .response-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-top: 8px; }
        .response-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .status-badge { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
        .status-badge.success { background: var(--success); color: #fff; }
        .status-badge.error { background: var(--error); color: #fff; }
        .response-body { flex: 1; overflow: auto; padding: 8px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre-wrap; word-break: break-word; }

        .save-row { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
        .save-row input { flex: 1; padding: 4px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; font-size: 12px; }

        .status-bar { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 11px; color: var(--muted); border-top: 1px solid var(--border); margin-top: 8px; }

        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; color: var(--muted); text-align: center; }
        .empty-state p { margin: 4px 0; }

        .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--muted); border-top-color: var(--btn-bg); border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <h2>GraphQL Explorer</h2>

    <div class="toolbar">
        <input type="text" id="endpointUrl" placeholder="GraphQL endpoint URL (e.g., http://localhost:4000/graphql)" value="http://localhost:4000/graphql" />
        <button id="btnIntrospect">Introspect</button>
        <select id="envSelect" title="Environment">
            <option value="">No Environment</option>
        </select>
    </div>

    <div class="split">
        <div class="left-panel">
            <h3>Schema Explorer</h3>
            <div class="schema-tree" id="schemaTree">
                <div class="empty-state">
                    <p>No schema loaded.</p>
                    <p>Enter a URL and click Introspect.</p>
                </div>
            </div>
        </div>

        <div class="right-panel">
            <div class="editor-area">
                <div class="editor-section">
                    <label>Query</label>
                    <textarea id="queryEditor" placeholder="# Enter your GraphQL query here&#10;query {&#10;  __typename&#10;}"></textarea>
                </div>
                <div class="editor-section variables">
                    <label>Variables (JSON)</label>
                    <textarea id="variablesEditor" class="variables-editor" placeholder="{}"></textarea>
                </div>
                <div class="toolbar">
                    <button id="btnExecute">Execute Query</button>
                    <input type="text" id="operationName" placeholder="Operation name (optional)" style="max-width:200px;" />
                </div>
            </div>

            <div class="response-panel">
                <div class="response-header" id="responseHeader" style="display:none;">
                    <span class="status-badge" id="statusBadge"></span>
                    <span id="durationLabel" style="font-size:11px; color:var(--muted);"></span>
                </div>
                <div class="response-body" id="responseBody">
                    <span style="color:var(--muted);">Response will appear here after executing a query.</span>
                </div>
            </div>

            <div class="save-row">
                <input type="text" id="collectionName" placeholder="Collection name" />
                <input type="text" id="requestName" placeholder="Request name" />
                <button id="btnSave" class="secondary">Save to Collection</button>
            </div>
        </div>
    </div>

    <div class="status-bar" id="statusBar">
        <span id="statusText">Ready</span>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        const endpointUrl = document.getElementById('endpointUrl');
        const queryEditor = document.getElementById('queryEditor');
        const variablesEditor = document.getElementById('variablesEditor');
        const operationName = document.getElementById('operationName');
        const btnIntrospect = document.getElementById('btnIntrospect');
        const btnExecute = document.getElementById('btnExecute');
        const btnSave = document.getElementById('btnSave');
        const schemaTree = document.getElementById('schemaTree');
        const responseBody = document.getElementById('responseBody');
        const responseHeader = document.getElementById('responseHeader');
        const statusBadge = document.getElementById('statusBadge');
        const durationLabel = document.getElementById('durationLabel');
        const statusText = document.getElementById('statusText');
        const collectionName = document.getElementById('collectionName');
        const requestName = document.getElementById('requestName');
        const envSelect = document.getElementById('envSelect');

        btnIntrospect.addEventListener('click', () => {
            statusText.textContent = 'Introspecting...';
            btnIntrospect.disabled = true;
            vscode.postMessage({
                type: 'introspect',
                payload: { url: endpointUrl.value },
            });
        });

        btnExecute.addEventListener('click', () => {
            statusText.textContent = 'Executing query...';
            btnExecute.disabled = true;
            vscode.postMessage({
                type: 'execute-query',
                payload: {
                    url: endpointUrl.value,
                    query: queryEditor.value,
                    variables: variablesEditor.value,
                    operationName: operationName.value || undefined,
                },
            });
        });

        btnSave.addEventListener('click', () => {
            if (!collectionName.value.trim()) {
                collectionName.focus();
                return;
            }
            vscode.postMessage({
                type: 'save-to-collection',
                payload: {
                    collectionName: collectionName.value.trim(),
                    requestName: requestName.value.trim() || 'GraphQL Query',
                    url: endpointUrl.value,
                    query: queryEditor.value,
                    variables: variablesEditor.value,
                },
            });
        });

        envSelect.addEventListener('change', () => {
            const name = envSelect.value;
            if (name) {
                vscode.postMessage({ type: 'switch-environment', payload: { name } });
            }
        });

        // Request environments on load
        vscode.postMessage({ type: 'load-environments' });

        // ── Schema tree rendering ──

        function renderSchemaTree(nodes) {
            schemaTree.innerHTML = '';
            if (!nodes || nodes.length === 0) {
                schemaTree.innerHTML = '<div class="empty-state"><p>Schema is empty.</p></div>';
                return;
            }
            const fragment = document.createDocumentFragment();
            for (const node of nodes) {
                fragment.appendChild(createTreeNode(node));
            }
            schemaTree.appendChild(fragment);
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
                let expanded = node.kind === 'query' || node.kind === 'mutation' || node.kind === 'subscription';

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
                text.className = node.kind === 'category' ? 'tree-category' : 'tree-field';
                text.textContent = node.label;
                label.appendChild(text);

                if (node.description) {
                    const desc = document.createElement('span');
                    desc.className = 'tree-description';
                    desc.textContent = node.description;
                    label.appendChild(desc);
                }

                el.appendChild(label);
                el.appendChild(childContainer);
            } else {
                icon.textContent = '\\u2022';
                label.appendChild(icon);
                const text = document.createElement('span');
                text.className = 'tree-field' + (node.deprecated ? ' tree-deprecated' : '');
                text.textContent = node.label;
                label.appendChild(text);

                if (node.description) {
                    const desc = document.createElement('span');
                    desc.className = 'tree-description';
                    desc.textContent = node.description;
                    label.appendChild(desc);
                }

                el.appendChild(label);
            }

            return el;
        }

        // ── Message handling ──

        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'introspection-result': {
                    btnIntrospect.disabled = false;
                    renderSchemaTree(msg.payload.schemaTree);
                    const parts = [];
                    if (msg.payload.queryTypeName) parts.push('Query');
                    if (msg.payload.mutationTypeName) parts.push('Mutation');
                    if (msg.payload.subscriptionTypeName) parts.push('Subscription');
                    statusText.textContent =
                        'Schema loaded: ' + msg.payload.typeCount + ' types (' + parts.join(', ') + ')';
                    break;
                }
                case 'introspection-error': {
                    btnIntrospect.disabled = false;
                    statusText.textContent = 'Introspection failed: ' + msg.payload.message;
                    schemaTree.innerHTML = '<div class="empty-state"><p>Introspection failed.</p><p>' + escapeHtml(msg.payload.message) + '</p></div>';
                    break;
                }
                case 'query-result': {
                    btnExecute.disabled = false;
                    responseHeader.style.display = 'flex';
                    const isOk = msg.payload.status >= 200 && msg.payload.status < 300;
                    statusBadge.textContent = String(msg.payload.status);
                    statusBadge.className = 'status-badge ' + (isOk ? 'success' : 'error');
                    durationLabel.textContent = msg.payload.durationMs + 'ms';
                    responseBody.textContent = JSON.stringify(msg.payload.body, null, 2);
                    statusText.textContent = 'Query executed (' + msg.payload.durationMs + 'ms)';
                    break;
                }
                case 'query-error': {
                    btnExecute.disabled = false;
                    responseHeader.style.display = 'flex';
                    statusBadge.textContent = 'Error';
                    statusBadge.className = 'status-badge error';
                    durationLabel.textContent = msg.payload.durationMs ? msg.payload.durationMs + 'ms' : '';
                    responseBody.textContent = msg.payload.message;
                    statusText.textContent = 'Query failed: ' + msg.payload.message;
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

type SchemaTreeNode = {
    label: string;
    kind: string;
    description?: string;
    deprecated?: boolean;
    children?: SchemaTreeNode[];
    typeName?: string;
    typeKind?: string;
};

// ── Utility ───────────────────────────────────────────────────────

function typeRefToString(ref: GraphQLTypeRef | null | undefined): string {
    if (!ref) return 'unknown';
    switch (ref.kind) {
        case 'NON_NULL':
            return `${typeRefToString(ref.ofType)}!`;
        case 'LIST':
            return `[${typeRefToString(ref.ofType)}]`;
        default:
            return ref.name ?? 'unknown';
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

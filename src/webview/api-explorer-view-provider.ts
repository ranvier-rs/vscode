import * as vscode from 'vscode';
import { getApiExplorerWebviewHtml } from './templates/api-explorer-webview';
import { ServerConnectionManager } from '../core/server-connection';
import { CollectionStore } from '../core/collection-store';
import { EnvironmentStore, interpolateVariables } from '../core/environment-store';
import { generateTemplate, generateSample } from '../core/template-generator';
import {
    exportBundle, exportRequest, parseBundle, parseRequest,
    detectConflicts, applyImport, applyRequestImport,
    saveBundleToFile, saveRequestToFile, type RanvierBundle,
} from '../core/export-import';
import type { RedactionStrategy } from '../core/secret-redactor';
import { runBatch } from '../core/batch-runner';
import { validateBody } from '../core/body-validator';
import { WsClient } from '../core/ws-client';
import { SseClient } from '../core/sse-client';
import type { ApiResponseData, CollectionRequest, HistoryEntry, EnvironmentConfig } from '../shared/types';

export class RanvierApiExplorerProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _serverConnection?: ServerConnectionManager;
    private _collectionStore?: CollectionStore;
    private _environmentStore?: EnvironmentStore;
    private _activeCollection?: string;
    private _activeEnvironment?: string;
    private _environmentVariables: Record<string, string> = {};
    private _pendingImportBundle?: RanvierBundle;
    private _lastResponse?: ApiResponseData;
    private _lastTimelineNodes?: import('../shared/types').ApiTimelineNode[];
    private _batchAbortController?: AbortController;
    private _wsClient?: WsClient;
    private _sseClient?: SseClient;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _workspaceRoot?: string,
    ) { }

    /** Post a message to the webview (used by extension commands). */
    postToWebview(message: unknown) {
        this._view?.webview.postMessage(message);
    }

    setWorkspaceRoot(root: string) {
        this._collectionStore = new CollectionStore(root);
    }

    private _ensureConnection(): ServerConnectionManager {
        if (!this._serverConnection) {
            this._serverConnection = new ServerConnectionManager();
            this._serverConnection.onStateChange(() => this._sendConnectionMode());
            void this._serverConnection.connect();
        }
        return this._serverConnection;
    }

    private _ensureStore(): CollectionStore | undefined {
        if (!this._collectionStore && this._workspaceRoot) {
            this._collectionStore = new CollectionStore(this._workspaceRoot);
        }
        return this._collectionStore;
    }

    private _ensureEnvironmentStore(): EnvironmentStore | undefined {
        if (!this._environmentStore && this._workspaceRoot) {
            this._environmentStore = new EnvironmentStore(this._workspaceRoot);
        }
        return this._environmentStore;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this._ensureConnection();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ready':
                    this._sendConnectionMode();
                    await this._sendWorkspaceState();
                    break;

                case 'fetch-routes':
                    await this._handleFetchRoutes();
                    break;

                case 'send-request':
                    await this._handleSendRequest(data.payload);
                    break;

                case 'fetch-timeline':
                    await this._handleFetchTimeline(data.payload.traceId);
                    break;

                case 'direct-request':
                    await this._handleDirectRequest(data.payload);
                    break;

                case 'api-reveal-node':
                    vscode.commands.executeCommand('ranvier.revealNodeSource', data.payload.nodeId);
                    break;

                // Collection messages (M203)
                case 'load-collections':
                    await this._handleLoadCollections();
                    break;

                case 'load-collection':
                    await this._handleLoadCollection(data.payload.name);
                    break;

                case 'save-request':
                    await this._handleSaveRequest(data.payload.collectionName, data.payload.request);
                    break;

                case 'delete-request':
                    await this._handleDeleteRequest(data.payload.collectionName, data.payload.requestId);
                    break;

                case 'duplicate-request':
                    await this._handleDuplicateRequest(data.payload.collectionName, data.payload.requestId);
                    break;

                case 'rename-request':
                    await this._handleRenameRequest(data.payload.collectionName, data.payload.requestId, data.payload.newName);
                    break;

                case 'create-collection':
                    await this._handleCreateCollection(data.payload.name);
                    break;

                case 'delete-collection':
                    await this._handleDeleteCollection(data.payload.name);
                    break;

                case 'load-history':
                    await this._handleLoadHistory(data.payload?.limit);
                    break;

                case 'init-workspace':
                    await this._handleInitWorkspace();
                    break;

                // Template/Faker/Preset/Environment messages (M204)
                case 'generate-template':
                    await this._handleGenerateTemplate(data.payload);
                    break;

                case 'generate-sample':
                    await this._handleGenerateSample(data.payload);
                    break;

                case 'save-preset':
                    await this._handleSavePreset(data.payload.collectionName, data.payload.requestId, data.payload.preset);
                    break;

                case 'delete-preset':
                    await this._handleDeletePreset(data.payload.collectionName, data.payload.requestId, data.payload.presetName);
                    break;

                case 'load-presets':
                    await this._handleLoadPresets(data.payload.collectionName, data.payload.requestId);
                    break;

                case 'load-environments':
                    await this._handleLoadEnvironments();
                    break;

                case 'load-environment':
                    await this._handleLoadEnvironment(data.payload.name);
                    break;

                case 'save-environment':
                    await this._handleSaveEnvironment(data.payload.environment);
                    break;

                case 'switch-environment':
                    await this._handleSwitchEnvironment(data.payload.name);
                    break;

                // Export/Import messages (M205)
                case 'export-bundle':
                    await this._handleExportBundle(data.payload);
                    break;

                case 'export-request':
                    await this._handleExportRequest(data.payload);
                    break;

                case 'import-file':
                    await this._handleImportFile();
                    break;

                case 'resolve-conflicts':
                    await this._handleResolveConflicts(data.payload.resolution);
                    break;

                // Batch Execution & Validation messages (M206)
                case 'batch-send':
                    await this._handleBatchSend(data.payload.requestIds);
                    break;

                case 'batch-cancel':
                    this._batchAbortController?.abort();
                    break;

                case 'validate-body':
                    this._handleValidateBody(data.payload.body, data.payload.schema);
                    break;

                // WebSocket/SSE messages (M216)
                case 'ws-connect':
                    this._handleWsConnect(data.payload.url, data.payload.subprotocols);
                    break;

                case 'ws-disconnect':
                    this._wsClient?.disconnect();
                    break;

                case 'ws-send':
                    this._wsClient?.send(data.payload.data);
                    break;

                case 'sse-connect':
                    void this._handleSseConnect(data.payload.url, data.payload.lastEventId);
                    break;

                case 'sse-disconnect':
                    this._sseClient?.disconnect();
                    break;
            }
        });
    }

    private _sendConnectionMode() {
        const conn = this._serverConnection;
        const state = conn?.connectionState ?? 'disconnected';
        const mode = state === 'connected' ? 'connected'
            : state === 'error' || state === 'disconnected' ? 'offline'
                : 'offline';
        this._view?.webview.postMessage({
            type: 'api-connection-mode',
            payload: { mode },
        });
    }

    private async _sendWorkspaceState() {
        const store = this._ensureStore();
        if (!store) {
            this._view?.webview.postMessage({
                type: 'workspace-state',
                payload: { initialized: false, collections: [] },
            });
            return;
        }

        const initialized = store.isInitialized;
        const collections = initialized ? await store.listCollections() : [];
        this._view?.webview.postMessage({
            type: 'workspace-state',
            payload: {
                initialized,
                collections,
                activeCollection: this._activeCollection,
            },
        });
    }

    private async _handleFetchRoutes() {
        try {
            const conn = this._ensureConnection();
            const endpoints = await conn.fetchRoutes();
            this._view?.webview.postMessage({
                type: 'api-endpoints',
                payload: { endpoints },
            });
        } catch {
            this._view?.webview.postMessage({
                type: 'api-endpoints',
                payload: { endpoints: [] },
            });
        }
    }

    private _interpolatePayload(payload: { method: string; path: string; headers?: Record<string, string>; body?: unknown }) {
        const vars = this._environmentVariables;
        if (!vars || Object.keys(vars).length === 0) return payload;
        const interpolated = { ...payload };
        interpolated.path = interpolateVariables(interpolated.path, vars);
        if (interpolated.headers) {
            const h: Record<string, string> = {};
            for (const [k, v] of Object.entries(interpolated.headers)) {
                h[k] = interpolateVariables(v, vars);
            }
            interpolated.headers = h;
        }
        if (typeof interpolated.body === 'string') {
            interpolated.body = interpolateVariables(interpolated.body, vars);
        }
        return interpolated;
    }

    private async _handleSendRequest(payload: {
        method: string;
        path: string;
        headers?: Record<string, string>;
        body?: unknown;
    }) {
        try {
            const conn = this._ensureConnection();
            const interpolated = this._interpolatePayload(payload);
            const response = await conn.relayRequest(interpolated);
            this._lastResponse = response;
            this._view?.webview.postMessage({
                type: 'api-response',
                payload: response,
            });
            await this._autoSaveHistory(payload, response);
        } catch (e: any) {
            const errorResponse: ApiResponseData = {
                status: 0,
                headers: {},
                body: { error: e?.message || 'Request failed' },
                durationMs: 0,
                contentType: 'application/json',
            };
            this._view?.webview.postMessage({
                type: 'api-response',
                payload: errorResponse,
            });
        }
    }

    private async _handleFetchTimeline(traceId: string) {
        try {
            const conn = this._ensureConnection();
            const nodes = await conn.fetchTimeline(traceId);
            this._view?.webview.postMessage({
                type: 'api-timeline',
                payload: { nodes },
            });
        } catch {
            this._view?.webview.postMessage({
                type: 'api-timeline',
                payload: { nodes: [] },
            });
        }
    }

    private async _handleDirectRequest(payload: {
        url: string;
        method: string;
        headers?: Record<string, string>;
        body?: unknown;
    }) {
        // Apply environment variable interpolation
        const vars = this._environmentVariables;
        if (vars && Object.keys(vars).length > 0) {
            payload = { ...payload };
            payload.url = interpolateVariables(payload.url, vars);
            if (payload.headers) {
                const h: Record<string, string> = {};
                for (const [k, v] of Object.entries(payload.headers)) {
                    h[k] = interpolateVariables(v, vars);
                }
                payload.headers = h;
            }
        }

        const start = Date.now();
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const init: RequestInit = {
                method: payload.method,
                headers: payload.headers,
                signal: controller.signal,
            };
            if (payload.body && payload.method !== 'GET' && payload.method !== 'HEAD') {
                init.body = JSON.stringify(payload.body);
                init.headers = { ...init.headers as Record<string, string>, 'content-type': 'application/json' };
            }

            const res = await fetch(payload.url, init);
            clearTimeout(timeout);

            const durationMs = Date.now() - start;
            const contentType = res.headers.get('content-type') || '';
            const respHeaders: Record<string, string> = {};
            res.headers.forEach((v, k) => { respHeaders[k] = v; });

            let body: unknown;
            if (contentType.includes('application/json')) {
                body = await res.json();
            } else {
                body = await res.text();
            }

            const response: ApiResponseData = {
                status: res.status,
                headers: respHeaders,
                body,
                durationMs,
                contentType,
            };
            this._view?.webview.postMessage({
                type: 'direct-response',
                payload: response,
            });
            await this._autoSaveHistory(
                { method: payload.method, path: payload.url },
                response,
            );
        } catch (e: any) {
            this._view?.webview.postMessage({
                type: 'direct-response',
                payload: {
                    status: 0,
                    headers: {},
                    body: { error: e?.message || 'Request failed' },
                    durationMs: Date.now() - start,
                    contentType: 'application/json',
                } satisfies ApiResponseData,
            });
        }
    }

    // ── Collection handlers (M203) ────────────────────────────────

    private async _handleLoadCollections() {
        const store = this._ensureStore();
        if (!store) return;
        const collections = await store.listCollections();
        this._view?.webview.postMessage({
            type: 'collections-loaded',
            payload: { collections, activeCollection: this._activeCollection },
        });
    }

    private async _handleLoadCollection(name: string) {
        const store = this._ensureStore();
        if (!store) return;
        const collection = await store.loadCollection(name);
        if (collection) {
            this._activeCollection = name;
            this._view?.webview.postMessage({
                type: 'collection-loaded',
                payload: { collection },
            });
        }
    }

    private async _handleSaveRequest(collectionName: string, request: CollectionRequest) {
        const store = this._ensureStore();
        if (!store) return;
        await store.saveRequest(collectionName, request);
        this._view?.webview.postMessage({
            type: 'request-saved',
            payload: { collectionName, request },
        });
    }

    private async _handleDeleteRequest(collectionName: string, requestId: string) {
        const store = this._ensureStore();
        if (!store) return;
        await store.deleteRequest(collectionName, requestId);
        this._view?.webview.postMessage({
            type: 'request-deleted',
            payload: { collectionName, requestId },
        });
    }

    private async _handleDuplicateRequest(collectionName: string, requestId: string) {
        const store = this._ensureStore();
        if (!store) return;
        const duplicate = await store.duplicateRequest(collectionName, requestId);
        if (duplicate) {
            await this._handleLoadCollection(collectionName);
        }
    }

    private async _handleRenameRequest(collectionName: string, requestId: string, newName: string) {
        const store = this._ensureStore();
        if (!store) return;
        await store.renameRequest(collectionName, requestId, newName);
        await this._handleLoadCollection(collectionName);
    }

    private async _handleCreateCollection(name: string) {
        const store = this._ensureStore();
        if (!store) return;
        if (!store.isInitialized) {
            await store.init();
        }
        await store.createCollection(name);
        this._activeCollection = name;
        await this._handleLoadCollections();
        await this._handleLoadCollection(name);
    }

    private async _handleDeleteCollection(name: string) {
        const store = this._ensureStore();
        if (!store) return;
        await store.deleteCollection(name);
        if (this._activeCollection === name) {
            this._activeCollection = undefined;
        }
        await this._handleLoadCollections();
    }

    private async _handleLoadHistory(limit?: number) {
        const store = this._ensureStore();
        if (!store) return;
        const entries = await store.listHistory(limit ?? 100);
        this._view?.webview.postMessage({
            type: 'history-loaded',
            payload: { entries },
        });
    }

    private async _handleInitWorkspace() {
        const store = this._ensureStore();
        if (!store) return;
        await store.init();
        await this._sendWorkspaceState();
        vscode.window.showInformationMessage('Ranvier API workspace initialized (.ranvier/ created).');
    }

    private async _autoSaveHistory(
        req: { method: string; path: string },
        res: ApiResponseData,
    ) {
        const store = this._ensureStore();
        if (!store?.isInitialized) return;

        const config = vscode.workspace.getConfiguration('ranvier');
        const maxEntries = config.get<number>('apiExplorer.historySizeLimit', 100);

        const entry: HistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            requestId: '',
            requestName: `${req.method} ${req.path}`,
            method: req.method,
            path: req.path,
            status: res.status,
            durationMs: res.durationMs,
            executedAt: new Date().toISOString(),
        };

        try {
            await store.saveHistoryEntry(entry);
            await store.pruneHistory(maxEntries);
        } catch {
            // Silently fail — history is non-critical
        }
    }

    // ── Template/Faker handlers (M204) ────────────────────────────

    private async _handleGenerateTemplate(payload: { method: string; path: string; schema?: unknown }) {
        const conn = this._serverConnection;
        const result = await generateTemplate(conn, payload.method, payload.path, payload.schema);
        this._view?.webview.postMessage({
            type: 'template-generated',
            payload: result,
        });
    }

    private async _handleGenerateSample(payload: { method: string; path: string; schema?: unknown }) {
        const conn = this._serverConnection;
        const result = await generateSample(conn, payload.method, payload.path, payload.schema);
        this._view?.webview.postMessage({
            type: 'sample-generated',
            payload: result,
        });
    }

    // ── Preset handlers (M204) ──────────────────────────────────

    private async _handleSavePreset(collectionName: string, requestId: string, preset: import('../shared/types').RequestPreset) {
        const store = this._ensureStore();
        if (!store) return;
        await store.savePreset(collectionName, requestId, preset);
        await this._handleLoadPresets(collectionName, requestId);
    }

    private async _handleDeletePreset(collectionName: string, requestId: string, presetName: string) {
        const store = this._ensureStore();
        if (!store) return;
        await store.deletePreset(collectionName, requestId, presetName);
        await this._handleLoadPresets(collectionName, requestId);
    }

    private async _handleLoadPresets(collectionName: string, requestId: string) {
        const store = this._ensureStore();
        if (!store) return;
        const collection = await store.loadCollection(collectionName);
        if (!collection) return;
        const presets = store.getPresets(collection, requestId);
        this._view?.webview.postMessage({
            type: 'presets-loaded',
            payload: { collectionName, requestId, presets },
        });
    }

    // ── Environment handlers (M204) ─────────────────────────────

    private async _handleLoadEnvironments() {
        const envStore = this._ensureEnvironmentStore();
        if (!envStore) return;
        const environments = await envStore.listEnvironments();
        this._view?.webview.postMessage({
            type: 'environments-loaded',
            payload: { environments, activeEnvironment: this._activeEnvironment },
        });
    }

    private async _handleLoadEnvironment(name: string) {
        const envStore = this._ensureEnvironmentStore();
        if (!envStore) return;
        const environment = await envStore.loadEnvironment(name);
        if (environment) {
            this._view?.webview.postMessage({
                type: 'environment-loaded',
                payload: { environment },
            });
        }
    }

    private async _handleSaveEnvironment(environment: EnvironmentConfig) {
        const envStore = this._ensureEnvironmentStore();
        if (!envStore) return;
        await envStore.saveEnvironment(environment);
        await this._handleLoadEnvironments();
    }

    private async _handleSwitchEnvironment(name: string) {
        const envStore = this._ensureEnvironmentStore();
        if (!envStore) return;
        this._activeEnvironment = name;
        const env = await envStore.loadEnvironment(name);
        if (env) {
            this._environmentVariables = env.variables;
        }
        await this._handleLoadEnvironments();
    }

    // ── Export/Import handlers (M205) ─────────────────────────────

    private async _handleExportBundle(payload: {
        collectionNames: string[];
        environmentNames: string[];
        redactionStrategy: string;
    }) {
        const store = this._ensureStore();
        const envStore = this._ensureEnvironmentStore();
        if (!store || !envStore) return;

        const bundle = await exportBundle(
            store, envStore,
            payload.collectionNames,
            payload.environmentNames,
            payload.redactionStrategy as RedactionStrategy,
        );

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('export.ranvier-bundle.json'),
            filters: { 'Ranvier Bundle': ['ranvier-bundle.json', 'json'] },
        });
        if (!uri) return;

        await saveBundleToFile(bundle, uri.fsPath);
        const totalItems = bundle.collections.reduce((sum, c) => sum + c.requests.length, 0);
        this._view?.webview.postMessage({
            type: 'export-complete',
            payload: { path: uri.fsPath, itemCount: totalItems },
        });
        vscode.window.showInformationMessage(`Exported ${bundle.collections.length} collection(s) to ${uri.fsPath}`);
    }

    private async _handleExportRequest(payload: {
        collectionName: string;
        requestId: string;
        includeResponse: boolean;
    }) {
        const store = this._ensureStore();
        if (!store) return;

        const collection = await store.loadCollection(payload.collectionName);
        if (!collection) return;
        const request = collection.requests.find(r => r.id === payload.requestId);
        if (!request) return;

        const exported = exportRequest(
            request,
            payload.includeResponse ? this._lastResponse : undefined,
            payload.includeResponse ? this._lastTimelineNodes : undefined,
        );

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${request.name.replace(/\s+/g, '-')}.ranvier-request.json`),
            filters: { 'Ranvier Request': ['ranvier-request.json', 'json'] },
        });
        if (!uri) return;

        await saveRequestToFile(exported, uri.fsPath);
        this._view?.webview.postMessage({
            type: 'export-complete',
            payload: { path: uri.fsPath, itemCount: 1 },
        });
        vscode.window.showInformationMessage(`Exported request to ${uri.fsPath}`);
    }

    private async _handleImportFile() {
        const store = this._ensureStore();
        const envStore = this._ensureEnvironmentStore();
        if (!store || !envStore) return;

        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: {
                'Ranvier Files': ['ranvier-bundle.json', 'ranvier-request.json', 'json'],
            },
        });
        if (!uris || uris.length === 0) return;
        const firstUri = uris[0];
        if (!firstUri) return;

        const filePath = firstUri.fsPath;
        const content = await (await import('node:fs/promises')).readFile(filePath, 'utf-8');

        try {
            if (filePath.includes('ranvier-request')) {
                // Single request import
                const request = parseRequest(content);
                if (!this._activeCollection) {
                    vscode.window.showWarningMessage('Select a collection before importing a request.');
                    return;
                }
                await applyRequestImport(store, this._activeCollection, request);
                await this._handleLoadCollection(this._activeCollection);
                this._view?.webview.postMessage({
                    type: 'import-complete',
                    payload: { collections: 0, environments: 0 },
                });
                vscode.window.showInformationMessage('Request imported successfully.');
            } else {
                // Bundle import
                const bundle = parseBundle(content);
                const conflicts = await detectConflicts(store, envStore, bundle);

                if (conflicts.length > 0) {
                    this._pendingImportBundle = bundle;
                    this._view?.webview.postMessage({
                        type: 'import-conflicts',
                        payload: { conflicts },
                    });
                } else {
                    // No conflicts — import directly
                    const result = await applyImport(store, envStore, bundle, 'replace', new Set());
                    await this._sendWorkspaceState();
                    this._view?.webview.postMessage({
                        type: 'import-complete',
                        payload: result,
                    });
                    vscode.window.showInformationMessage(
                        `Imported ${result.collections} collection(s) and ${result.environments} environment(s).`,
                    );
                }
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(`Import failed: ${e?.message || 'Unknown error'}`);
        }
    }

    private async _handleResolveConflicts(resolution: 'replace' | 'skip') {
        const store = this._ensureStore();
        const envStore = this._ensureEnvironmentStore();
        if (!store || !envStore || !this._pendingImportBundle) return;

        const bundle = this._pendingImportBundle;
        this._pendingImportBundle = undefined;

        const conflictNames = new Set<string>();
        const conflicts = await detectConflicts(store, envStore, bundle);
        for (const c of conflicts) {
            conflictNames.add(`${c.type}:${c.name}`);
        }

        const result = await applyImport(store, envStore, bundle, resolution, conflictNames);
        await this._sendWorkspaceState();
        this._view?.webview.postMessage({
            type: 'import-complete',
            payload: result,
        });
        vscode.window.showInformationMessage(
            `Imported ${result.collections} collection(s) and ${result.environments} environment(s).`,
        );
    }

    // ── Batch Execution & Validation handlers (M206) ──────────────

    private async _handleBatchSend(requestIds: string[]) {
        const store = this._ensureStore();
        if (!store || !this._activeCollection) return;

        const collection = await store.loadCollection(this._activeCollection);
        if (!collection) return;

        const requests = requestIds
            .map(id => collection.requests.find(r => r.id === id))
            .filter((r): r is CollectionRequest => r !== undefined);

        if (requests.length === 0) return;

        this._batchAbortController = new AbortController();

        const sendFn = async (req: CollectionRequest): Promise<ApiResponseData> => {
            const payload = this._interpolatePayload({
                method: req.method,
                path: req.path,
                headers: req.headers,
                body: req.body,
            });

            const conn = this._serverConnection;
            if (conn && conn.connectionState === 'connected') {
                return await conn.relayRequest(payload);
            }

            // Direct request fallback
            const start = Date.now();
            const url = payload.path;
            const init: RequestInit = {
                method: payload.method,
                headers: payload.headers,
                signal: this._batchAbortController?.signal,
            };
            if (payload.body && payload.method !== 'GET' && payload.method !== 'HEAD') {
                init.body = JSON.stringify(payload.body);
                init.headers = { ...init.headers as Record<string, string>, 'content-type': 'application/json' };
            }

            const res = await fetch(url, init);
            const durationMs = Date.now() - start;
            const contentType = res.headers.get('content-type') || '';
            const respHeaders: Record<string, string> = {};
            res.headers.forEach((v, k) => { respHeaders[k] = v; });

            let body: unknown;
            if (contentType.includes('application/json')) {
                body = await res.json();
            } else {
                body = await res.text();
            }

            return { status: res.status, headers: respHeaders, body, durationMs, contentType };
        };

        const summary = await runBatch(requests, sendFn, {
            bail: false,
            signal: this._batchAbortController.signal,
            onProgress: (progress) => {
                this._view?.webview.postMessage({
                    type: 'batch-progress',
                    payload: progress,
                });
            },
        });

        this._batchAbortController = undefined;

        this._view?.webview.postMessage({
            type: 'batch-complete',
            payload: {
                total: summary.total,
                passed: summary.passed,
                failed: summary.failed,
                errors: summary.errors,
                skipped: summary.skipped,
                totalDurationMs: summary.totalDurationMs,
                results: summary.results.map(r => ({
                    requestId: r.request.id,
                    requestName: r.request.name,
                    status: r.status,
                    responseStatus: r.response?.status ?? 0,
                    durationMs: r.response?.durationMs ?? 0,
                    assertionsPassed: r.assertions.filter(a => a.passed).length,
                    assertionsTotal: r.assertions.length,
                    error: r.error,
                })),
            },
        });
    }

    private _handleValidateBody(body: unknown, schema: unknown) {
        const result = validateBody(body, schema);
        this._view?.webview.postMessage({
            type: 'validation-result',
            payload: result,
        });
    }

    /** Called from extension.ts `ranvier.importBundle` command */
    async handleImportFromCommand(rawJson: string) {
        const store = this._ensureStore();
        const envStore = this._ensureEnvironmentStore();
        if (!store || !envStore) return;

        try {
            const bundle = parseBundle(rawJson);
            const conflicts = await detectConflicts(store, envStore, bundle);

            if (conflicts.length > 0) {
                this._pendingImportBundle = bundle;
                this._view?.webview.postMessage({
                    type: 'import-conflicts',
                    payload: { conflicts },
                });
            } else {
                const result = await applyImport(store, envStore, bundle, 'replace', new Set());
                await this._sendWorkspaceState();
                this._view?.webview.postMessage({
                    type: 'import-complete',
                    payload: result,
                });
                vscode.window.showInformationMessage(
                    `Imported ${result.collections} collection(s) and ${result.environments} environment(s).`,
                );
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(`Import failed: ${e?.message || 'Unknown error'}`);
        }
    }

    // ── WebSocket/SSE handlers (M216) ─────────────────────────────

    private _handleWsConnect(url: string, subprotocols?: string[]) {
        if (!this._wsClient) {
            this._wsClient = new WsClient(
                (state, wsUrl) => {
                    this._view?.webview.postMessage({
                        type: 'ws-state',
                        payload: { state, url: wsUrl },
                    });
                },
                (entry) => {
                    this._view?.webview.postMessage({
                        type: 'ws-message',
                        payload: entry,
                    });
                },
            );
        }
        this._wsClient.connect(url, subprotocols);
    }

    private async _handleSseConnect(url: string, lastEventId?: string) {
        if (!this._sseClient) {
            this._sseClient = new SseClient(
                (state, sseUrl) => {
                    this._view?.webview.postMessage({
                        type: 'sse-state',
                        payload: { state, url: sseUrl },
                    });
                },
                (event) => {
                    this._view?.webview.postMessage({
                        type: 'sse-event',
                        payload: event,
                    });
                },
            );
        }
        await this._sseClient.connect(url, lastEventId);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.js'),
        );
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.css'),
        );
        const nonce = getNonce();

        return getApiExplorerWebviewHtml({
            webview,
            htmlLang: vscode.env.language.toLowerCase().startsWith('ko') ? 'ko' : 'en',
            nonce,
            cssUri,
            jsUri,
            extensionUri: this._extensionUri,
        } as any);
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

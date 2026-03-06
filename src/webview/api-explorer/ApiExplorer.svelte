<script lang="ts">
  import type {
    ApiEndpoint,
    ApiResponseData,
    ApiTimelineNode,
    ConnectionMode,
    ApiExplorerState,
    CollectionRequest,
    CollectionMeta,
    HistoryEntry,
    Collection,
    RequestPreset,
    EnvironmentMeta,
    WsConnectionState,
    WsLogEntry,
    SseEvent,
    EndpointProtocol,
  } from '../../shared/types';
  import RequestList from './RequestList.svelte';

  // VSCode API
  declare function acquireVsCodeApi(): {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
  };

  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────

  let endpoints: ApiEndpoint[] = $state([]);
  let selectedEndpoint: ApiEndpoint | null = $state(null);
  let connectionMode: ConnectionMode = $state('offline');
  let explorerState: ApiExplorerState = $state('idle');

  // Request editor
  let requestMethod = $state('GET');
  let requestPath = $state('');
  let requestManualUrl = $state('');
  let requestHeaders: { key: string; value: string; enabled: boolean }[] = $state([]);
  let requestBody = $state('');
  let authType: 'none' | 'bearer' | 'apiKey' | 'custom' = $state('none');
  let authToken = $state('');
  let authHeaderName = $state('');
  let authHeaderValue = $state('');
  let activeTab: 'headers' | 'params' | 'body' | 'auth' = $state('body');

  // Response
  let response: ApiResponseData | null = $state(null);
  let timelineNodes: ApiTimelineNode[] = $state([]);
  let expandedTraceNodes: Set<string> = $state(new Set());

  // Collection state (M203)
  let collections: CollectionMeta[] = $state([]);
  let activeCollectionName: string | undefined = $state(undefined);
  let collectionRequests: CollectionRequest[] = $state([]);
  let historyEntries: HistoryEntry[] = $state([]);
  let workspaceInitialized = $state(false);
  let selectedRequestIds: Set<string> = $state(new Set());

  // Preset state (M204)
  let currentRequestId: string | undefined = $state(undefined);
  let presets: RequestPreset[] = $state([]);
  let activePresetName: string | undefined = $state(undefined);

  // Environment state (M204)
  let environments: EnvironmentMeta[] = $state([]);
  let activeEnvironment: string | undefined = $state(undefined);

  // Export/Import state (M205)
  let importConflicts: { type: string; name: string; existingItemCount?: number }[] = $state([]);
  let showExportMenu = $state(false);

  // Batch execution state (M206)
  let batchRunning = $state(false);
  let batchProgress: { current: number; total: number; requestName: string } | null = $state(null);
  let batchResults: {
    total: number; passed: number; failed: number; errors: number; skipped: number;
    totalDurationMs: number;
    results: { requestId: string; requestName: string; status: string; responseStatus: number; durationMs: number; assertionsPassed: number; assertionsTotal: number; error?: string }[];
  } | null = $state(null);

  // Body validation state (M206)
  let validationDiagnostics: { path: string; severity: string; message: string }[] = $state([]);
  let validationSummary: { valid: number; warnings: number; errors: number } = $state({ valid: 0, warnings: 0, errors: 0 });

  // Search filter (shared between RequestList and inline)
  let searchFilter = $state('');

  // ── WebSocket/SSE state (M216) ────────────────────────────────
  let protocolMode: EndpointProtocol = $state('http');
  let wsUrl = $state('');
  let wsState: WsConnectionState = $state('disconnected');
  let wsMessages: WsLogEntry[] = $state([]);
  let wsInput = $state('');
  let sseUrl = $state('');
  let sseState: WsConnectionState = $state('disconnected');
  let sseEvents: SseEvent[] = $state([]);

  // ── Computed ───────────────────────────────────────────────────

  let statusBadgeClass = $derived(
    response
      ? response.status >= 200 && response.status < 300
        ? 'badge-success'
        : response.status >= 400
          ? 'badge-error'
          : 'badge-warning'
      : ''
  );

  let responseContentType = $derived(
    response?.contentType || response?.headers?.['content-type'] || ''
  );

  let isJsonResponse = $derived(responseContentType.includes('application/json'));

  let formattedResponseBody = $derived.by(() => {
    if (!response) return '';
    if (response.status === 204) return '(empty response)';
    if (isJsonResponse && typeof response.body === 'object') {
      return JSON.stringify(response.body, null, 2);
    }
    if (typeof response.body === 'string') return response.body;
    return JSON.stringify(response.body, null, 2);
  });

  // ── Restore state ─────────────────────────────────────────────

  const savedState = vscode.getState();
  if (savedState) {
    requestMethod = savedState.requestMethod ?? 'GET';
    requestPath = savedState.requestPath ?? '';
    requestManualUrl = savedState.requestManualUrl ?? '';
    requestBody = savedState.requestBody ?? '';
    authType = savedState.authType ?? 'none';
    requestHeaders = savedState.requestHeaders ?? [];
  }

  function saveState() {
    vscode.setState({
      requestMethod,
      requestPath,
      requestManualUrl,
      requestBody,
      authType,
      requestHeaders,
    });
  }

  // ── Message handling ──────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'api-endpoints':
        endpoints = msg.payload.endpoints;
        break;
      case 'api-response':
        response = msg.payload;
        explorerState = (response!.status >= 200 && response!.status < 400) ? 'success' : 'error';
        if (response?.traceId) {
          vscode.postMessage({ type: 'fetch-timeline', payload: { traceId: response.traceId } });
        }
        break;
      case 'direct-response':
        response = msg.payload;
        explorerState = (response!.status >= 200 && response!.status < 400) ? 'success' : 'error';
        break;
      case 'api-timeline':
        timelineNodes = msg.payload.nodes;
        break;
      case 'api-connection-mode':
        connectionMode = msg.payload.mode;
        break;
      // Collection messages (M203)
      case 'workspace-state':
        workspaceInitialized = msg.payload.initialized;
        collections = msg.payload.collections;
        activeCollectionName = msg.payload.activeCollection;
        break;
      case 'collections-loaded':
        collections = msg.payload.collections;
        activeCollectionName = msg.payload.activeCollection;
        break;
      case 'collection-loaded':
        collectionRequests = (msg.payload.collection as Collection).requests;
        break;
      case 'request-saved':
      case 'request-deleted':
        // Reload active collection to refresh list
        if (activeCollectionName) {
          vscode.postMessage({ type: 'load-collection', payload: { name: activeCollectionName } });
        }
        break;
      case 'history-loaded':
        historyEntries = msg.payload.entries;
        break;
      // M204 messages
      case 'template-generated':
      case 'sample-generated':
        if (msg.payload.body !== null && msg.payload.body !== undefined) {
          requestBody = typeof msg.payload.body === 'string'
            ? msg.payload.body
            : JSON.stringify(msg.payload.body, null, 2);
          saveState();
        }
        break;
      case 'presets-loaded':
        presets = msg.payload.presets;
        break;
      case 'environments-loaded':
        environments = msg.payload.environments;
        activeEnvironment = msg.payload.activeEnvironment;
        break;
      // M205 messages
      case 'export-complete':
        showExportMenu = false;
        break;
      case 'import-complete':
        importConflicts = [];
        vscode.postMessage({ type: 'load-collections' });
        break;
      case 'import-conflicts':
        importConflicts = msg.payload.conflicts;
        break;
      // M206 messages
      case 'batch-progress':
        batchProgress = msg.payload;
        break;
      case 'batch-complete':
        batchRunning = false;
        batchProgress = null;
        batchResults = msg.payload;
        break;
      case 'validation-result':
        validationDiagnostics = msg.payload.diagnostics;
        validationSummary = { valid: msg.payload.valid, warnings: msg.payload.warnings, errors: msg.payload.errors };
        break;
      // Keyboard shortcut actions (M206)
      case 'keyboard-action':
        if (msg.payload.action === 'send') sendRequest();
        else if (msg.payload.action === 'template') fillTemplate();
        else if (msg.payload.action === 'faker') fillWithFaker();
        break;
      // WebSocket/SSE messages (M216)
      case 'ws-state':
        wsState = msg.payload.state;
        break;
      case 'ws-message':
        wsMessages = [...wsMessages, msg.payload];
        break;
      case 'sse-state':
        sseState = msg.payload.state;
        break;
      case 'sse-event':
        sseEvents = [...sseEvents, msg.payload];
        break;
    }
  });

  // ── Initialize ────────────────────────────────────────────────

  vscode.postMessage({ type: 'ready' });
  vscode.postMessage({ type: 'fetch-routes' });
  vscode.postMessage({ type: 'load-environments' });

  // ── Actions ───────────────────────────────────────────────────

  function selectEndpoint(ep: ApiEndpoint) {
    selectedEndpoint = ep;
    requestMethod = ep.method;
    requestPath = ep.path;
    activeTab = ep.inputSchema ? 'body' : 'headers';
    saveState();
  }

  function selectCollectionRequest(req: CollectionRequest) {
    currentRequestId = req.id;
    requestMethod = req.method;
    requestPath = req.path;
    if (req.body) {
      requestBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    }
    if (req.headers) {
      requestHeaders = Object.entries(req.headers).map(([key, value]) => ({ key, value, enabled: true }));
    }
    if (req.auth) {
      if (req.auth.type === 'bearer') {
        authType = 'bearer';
        authToken = req.auth.token;
      } else if (req.auth.type === 'apiKey') {
        authType = 'apiKey';
        authHeaderName = req.auth.headerName;
        authHeaderValue = req.auth.value;
      } else if (req.auth.type === 'custom') {
        authType = 'custom';
        authHeaderName = req.auth.headerName;
        authHeaderValue = req.auth.headerValue;
      } else {
        authType = 'none';
      }
    }
    saveState();
  }

  function saveCurrentRequest() {
    if (!activeCollectionName) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const req: CollectionRequest = {
      id,
      name: `${requestMethod} ${requestPath}`,
      method: requestMethod,
      path: requestPath,
      headers: buildRequestHeaders(),
      params: {},
      body: requestBody.trim() ? (() => { try { return JSON.parse(requestBody); } catch { return requestBody; } })() : undefined,
    };
    vscode.postMessage({ type: 'save-request', payload: { collectionName: activeCollectionName, request: req } });
  }

  function toggleSelectId(id: string) {
    const next = new Set(selectedRequestIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedRequestIds = next;
  }

  function addHeader() {
    requestHeaders = [...requestHeaders, { key: '', value: '', enabled: true }];
    saveState();
  }

  function removeHeader(index: number) {
    requestHeaders = requestHeaders.filter((_, i) => i !== index);
    saveState();
  }

  function buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const h of requestHeaders) {
      if (h.enabled && h.key) {
        headers[h.key] = h.value;
      }
    }
    // Auth
    if (authType === 'bearer' && authToken) {
      headers['authorization'] = `Bearer ${authToken}`;
    } else if (authType === 'apiKey' && authHeaderName && authHeaderValue) {
      headers[authHeaderName] = authHeaderValue;
    } else if (authType === 'custom' && authHeaderName && authHeaderValue) {
      headers[authHeaderName] = authHeaderValue;
    }
    return headers;
  }

  function sendRequest() {
    explorerState = 'sending';
    response = null;
    timelineNodes = [];
    expandedTraceNodes = new Set();
    saveState();

    const headers = buildRequestHeaders();
    let body: unknown = undefined;
    if (requestBody.trim() && requestMethod !== 'GET' && requestMethod !== 'HEAD') {
      try {
        body = JSON.parse(requestBody);
      } catch {
        body = requestBody;
      }
    }

    if (connectionMode === 'connected') {
      vscode.postMessage({
        type: 'send-request',
        payload: { method: requestMethod, path: requestPath, headers, body },
      });
    } else {
      // Direct request (offline mode)
      const url = requestManualUrl || requestPath;
      vscode.postMessage({
        type: 'direct-request',
        payload: { url, method: requestMethod, headers, body },
      });
    }
  }

  function refreshRoutes() {
    vscode.postMessage({ type: 'fetch-routes' });
  }

  function toggleTraceNode(nodeId: string) {
    const next = new Set(expandedTraceNodes);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    expandedTraceNodes = next;
  }

  function revealNodeSource(nodeId: string) {
    vscode.postMessage({ type: 'api-reveal-node', payload: { nodeId } });
  }

  // ── Template/Faker (M204) ─────────────────────────────────────

  function fillTemplate() {
    vscode.postMessage({
      type: 'generate-template',
      payload: {
        method: requestMethod,
        path: requestPath,
        schema: selectedEndpoint?.inputSchema,
      },
    });
  }

  function fillWithFaker() {
    vscode.postMessage({
      type: 'generate-sample',
      payload: {
        method: requestMethod,
        path: requestPath,
        schema: selectedEndpoint?.inputSchema,
      },
    });
  }

  // ── Preset actions (M204) ───────────────────────────────────

  function saveAsPreset() {
    if (!activeCollectionName || !currentRequestId) return;
    const name = prompt('Preset name:');
    if (!name) return;
    let body: unknown;
    try { body = JSON.parse(requestBody); } catch { body = requestBody; }
    vscode.postMessage({
      type: 'save-preset',
      payload: {
        collectionName: activeCollectionName,
        requestId: currentRequestId,
        preset: { name, body, source: 'manual' as const },
      },
    });
  }

  function loadPreset(preset: RequestPreset) {
    activePresetName = preset.name;
    if (preset.body !== undefined) {
      requestBody = typeof preset.body === 'string'
        ? preset.body
        : JSON.stringify(preset.body, null, 2);
      saveState();
    }
  }

  function deletePreset(presetName: string) {
    if (!activeCollectionName || !currentRequestId) return;
    vscode.postMessage({
      type: 'delete-preset',
      payload: { collectionName: activeCollectionName, requestId: currentRequestId, presetName },
    });
  }

  // ── Environment actions (M204) ──────────────────────────────

  function switchEnvironment(name: string) {
    vscode.postMessage({ type: 'switch-environment', payload: { name } });
  }

  // ── Batch execution actions (M206) ──────────────────────────

  function batchSend() {
    const ids = Array.from(selectedRequestIds);
    if (ids.length === 0) return;
    batchRunning = true;
    batchResults = null;
    batchProgress = null;
    vscode.postMessage({ type: 'batch-send', payload: { requestIds: ids } });
  }

  function batchCancel() {
    vscode.postMessage({ type: 'batch-cancel' });
  }

  function validateCurrentBody() {
    if (!requestBody.trim() || !selectedEndpoint?.inputSchema) return;
    let parsed: unknown;
    try { parsed = JSON.parse(requestBody); } catch { return; }
    vscode.postMessage({
      type: 'validate-body',
      payload: { body: parsed, schema: selectedEndpoint.inputSchema },
    });
  }

  // ── Export/Import actions (M205) ────────────────────────────

  function exportBundle() {
    const collectionNames = collections.map(c => c.name);
    vscode.postMessage({
      type: 'export-bundle',
      payload: { collectionNames, environmentNames: environments.map(e => e.name), redactionStrategy: 'redact' },
    });
    showExportMenu = false;
  }

  function exportCurrentRequest() {
    if (!activeCollectionName || !currentRequestId) return;
    vscode.postMessage({
      type: 'export-request',
      payload: { collectionName: activeCollectionName, requestId: currentRequestId, includeResponse: !!response },
    });
    showExportMenu = false;
  }

  function importFile() {
    vscode.postMessage({ type: 'import-file' });
  }

  function resolveConflicts(resolution: 'replace' | 'skip') {
    vscode.postMessage({ type: 'resolve-conflicts', payload: { resolution } });
  }

  // ── WebSocket/SSE actions (M216) ────────────────────────────

  function wsConnect() {
    if (!wsUrl.trim()) return;
    wsMessages = [];
    vscode.postMessage({ type: 'ws-connect', payload: { url: wsUrl } });
  }

  function wsDisconnect() {
    vscode.postMessage({ type: 'ws-disconnect' });
  }

  function wsSendMessage() {
    if (!wsInput.trim() || wsState !== 'connected') return;
    vscode.postMessage({ type: 'ws-send', payload: { data: wsInput } });
    wsInput = '';
  }

  function wsClearLog() {
    wsMessages = [];
  }

  function sseConnect() {
    if (!sseUrl.trim()) return;
    sseEvents = [];
    vscode.postMessage({ type: 'sse-connect', payload: { url: sseUrl } });
  }

  function sseDisconnect() {
    vscode.postMessage({ type: 'sse-disconnect' });
  }

  function sseClearLog() {
    sseEvents = [];
  }

  function methodColor(method: string): string {
    switch (method.toUpperCase()) {
      case 'GET': return 'var(--vscode-charts-green)';
      case 'POST': return 'var(--vscode-charts-yellow)';
      case 'PUT': return 'var(--vscode-charts-orange)';
      case 'DELETE': return 'var(--vscode-charts-red)';
      case 'PATCH': return 'var(--vscode-charts-purple)';
      default: return 'var(--vscode-foreground)';
    }
  }
</script>

<div class="api-explorer">
  <!-- Connection Status Bar -->
  <div class="status-bar">
    <span class="connection-dot" class:connected={connectionMode === 'connected'} class:cached={connectionMode === 'disconnected-cached'} class:offline={connectionMode === 'offline'}></span>
    <span class="connection-label">
      {#if connectionMode === 'connected'}Connected{:else if connectionMode === 'disconnected-cached'}Disconnected (cached){:else}Offline{/if}
    </span>
    {#if environments.length > 0}
      <span class="env-separator">|</span>
      <select class="env-picker" value={activeEnvironment ?? ''} onchange={(e) => {
        const sel = /** @type {HTMLSelectElement} */ (e.currentTarget);
        if (sel.value) switchEnvironment(sel.value);
      }}>
        <option value="" disabled>Env...</option>
        {#each environments as env}
          <option value={env.name}>{env.name}</option>
        {/each}
      </select>
    {/if}
    <div class="export-import-group">
      <button class="icon-btn" onclick={importFile} title="Import collection">&#x2191;</button>
      <div class="export-dropdown-wrapper">
        <button class="icon-btn" onclick={() => showExportMenu = !showExportMenu} title="Export">&#x2193;</button>
        {#if showExportMenu}
          <div class="export-dropdown">
            <button onclick={exportBundle}>Export All Collections</button>
            {#if currentRequestId && activeCollectionName}
              <button onclick={exportCurrentRequest}>Export Current Request</button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    <button class="icon-btn" onclick={refreshRoutes} title="Refresh endpoints">&#x21bb;</button>
  </div>

  <div class="explorer-layout">
    <!-- Left: Request List (M203) -->
    <div class="endpoint-list">
      <RequestList
        {endpoints}
        {collections}
        activeCollection={activeCollectionName}
        {collectionRequests}
        {historyEntries}
        {workspaceInitialized}
        {searchFilter}
        selectedIds={selectedRequestIds}
        onSelectEndpoint={selectEndpoint}
        onSelectRequest={selectCollectionRequest}
        onToggleSelect={toggleSelectId}
        onDeleteRequest={(col, id) => vscode.postMessage({ type: 'delete-request', payload: { collectionName: col, requestId: id } })}
        onDuplicateRequest={(col, id) => vscode.postMessage({ type: 'duplicate-request', payload: { collectionName: col, requestId: id } })}
        onRenameRequest={(col, id) => {
          const newName = prompt('New request name:');
          if (newName) vscode.postMessage({ type: 'rename-request', payload: { collectionName: col, requestId: id, newName } });
        }}
        onLoadCollection={(name) => vscode.postMessage({ type: 'load-collection', payload: { name } })}
        onCreateCollection={() => {
          const name = prompt('Collection name:');
          if (name) vscode.postMessage({ type: 'create-collection', payload: { name } });
        }}
        onDeleteCollection={(name) => vscode.postMessage({ type: 'delete-collection', payload: { name } })}
        onLoadHistory={() => vscode.postMessage({ type: 'load-history', payload: {} })}
        onInitWorkspace={() => vscode.postMessage({ type: 'init-workspace' })}
        onRefreshRoutes={refreshRoutes}
      />
    </div>

    <!-- Right: Request/Response -->
    <div class="request-response">
      <!-- Protocol Mode Tabs (M216) -->
      <div class="protocol-tabs">
        <button class="protocol-tab" class:active={protocolMode === 'http'} onclick={() => protocolMode = 'http'}>HTTP</button>
        <button class="protocol-tab" class:active={protocolMode === 'ws'} onclick={() => protocolMode = 'ws'}>
          WS
          {#if wsState === 'connected'}<span class="protocol-dot connected"></span>{/if}
        </button>
        <button class="protocol-tab" class:active={protocolMode === 'sse'} onclick={() => protocolMode = 'sse'}>
          SSE
          {#if sseState === 'connected'}<span class="protocol-dot connected"></span>{/if}
        </button>
      </div>

      {#if protocolMode === 'http'}
      <!-- URL Bar -->
      <div class="url-bar">
        <select bind:value={requestMethod} onchange={saveState}>
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>DELETE</option>
          <option>PATCH</option>
          <option>HEAD</option>
          <option>OPTIONS</option>
        </select>
        {#if connectionMode === 'connected'}
          <input
            type="text"
            class="url-input"
            placeholder="/api/..."
            bind:value={requestPath}
            onchange={saveState}
          />
        {:else}
          <input
            type="text"
            class="url-input"
            placeholder="http://localhost:3111/api/..."
            bind:value={requestManualUrl}
            onchange={saveState}
          />
        {/if}
        <button class="send-btn" onclick={sendRequest} disabled={explorerState === 'sending'}>
          {#if explorerState === 'sending'}Sending...{:else}Send{/if}
        </button>
        {#if activeCollectionName}
          <button class="save-btn" onclick={saveCurrentRequest} title="Save to {activeCollectionName}">Save</button>
        {/if}
        {#if selectedRequestIds.size > 0}
          {#if batchRunning}
            <button class="batch-btn cancel" onclick={batchCancel}>Cancel ({batchProgress?.current ?? 0}/{batchProgress?.total ?? 0})</button>
          {:else}
            <button class="batch-btn" onclick={batchSend} title="Send all selected requests">Batch ({selectedRequestIds.size})</button>
          {/if}
        {/if}
      </div>

      <!-- Ingress Context -->
      {#if selectedEndpoint}
        <div class="ingress-context">
          {#if selectedEndpoint.circuitName}
            <span class="context-label">Circuit:</span>
            <button class="context-value circuit-link" onclick={() => vscode.postMessage({ type: 'api-reveal-node', payload: { nodeId: selectedEndpoint?.circuitName ?? '' } })} title="View in Circuit">{selectedEndpoint.circuitName}</button>
          {/if}
          {#if selectedEndpoint.inputSchema}
            <button class="template-btn" onclick={fillTemplate}>Template</button>
            <button class="template-btn" onclick={fillWithFaker}>Faker</button>
          {/if}
        </div>
      {/if}

      <!-- Request Tabs -->
      <div class="tab-bar">
        <button class="tab" class:active={activeTab === 'headers'} onclick={() => activeTab = 'headers'}>Headers</button>
        <button class="tab" class:active={activeTab === 'params'} onclick={() => activeTab = 'params'}>Params</button>
        <button class="tab" class:active={activeTab === 'body'} onclick={() => activeTab = 'body'}>Body</button>
        <button class="tab" class:active={activeTab === 'auth'} onclick={() => activeTab = 'auth'}>Auth</button>
      </div>

      <div class="tab-content">
        {#if activeTab === 'headers'}
          <div class="headers-editor">
            {#each requestHeaders as header, i}
              <div class="header-row">
                <input type="checkbox" bind:checked={header.enabled} />
                <input type="text" placeholder="Header name" bind:value={header.key} onchange={saveState} />
                <input type="text" placeholder="Value" bind:value={header.value} onchange={saveState} />
                <button class="remove-btn" onclick={() => removeHeader(i)}>x</button>
              </div>
            {/each}
            <button class="add-btn" onclick={addHeader}>+ Add Header</button>
          </div>

        {:else if activeTab === 'params'}
          <div class="params-info">
            <p class="hint">Path parameters are extracted from the URL pattern.</p>
            {#if selectedEndpoint?.path}
              {#each (selectedEndpoint.path.match(/:(\w+)/g) ?? []) as param}
                <div class="param-row">
                  <span class="param-name">{param}</span>
                  <input type="text" placeholder="value" />
                </div>
              {/each}
            {/if}
          </div>

        {:else if activeTab === 'body'}
          {#if presets.length > 0}
            <div class="preset-bar">
              <select value={activePresetName ?? ''} onchange={(e) => {
                const sel = /** @type {HTMLSelectElement} */ (e.currentTarget);
                const p = presets.find(pr => pr.name === sel.value);
                if (p) loadPreset(p);
              }}>
                <option value="">Base request</option>
                {#each presets as preset}
                  <option value={preset.name}>{preset.name} {preset.source ? `(${preset.source})` : ''}</option>
                {/each}
              </select>
              <button class="icon-btn" onclick={saveAsPreset} title="Save as preset">+</button>
            </div>
          {:else if currentRequestId && activeCollectionName}
            <div class="preset-bar">
              <button class="add-btn" onclick={saveAsPreset}>Save as Preset</button>
            </div>
          {/if}
          <textarea
            class="body-editor"
            placeholder={'{"key": "value"}'}
            bind:value={requestBody}
            onchange={saveState}
            spellcheck="false"
          ></textarea>
          {#if selectedEndpoint?.inputSchema}
            <div class="validation-bar">
              <button class="template-btn" onclick={validateCurrentBody}>Validate</button>
              {#if validationDiagnostics.length > 0}
                <span class="validation-summary">
                  {#if validationSummary.errors > 0}
                    <span class="val-error">{validationSummary.errors} error{validationSummary.errors > 1 ? 's' : ''}</span>
                  {/if}
                  {#if validationSummary.warnings > 0}
                    <span class="val-warning">{validationSummary.warnings} warning{validationSummary.warnings > 1 ? 's' : ''}</span>
                  {/if}
                  {#if validationSummary.errors === 0 && validationSummary.warnings === 0}
                    <span class="val-ok">Valid</span>
                  {/if}
                </span>
              {/if}
            </div>
            {#if validationDiagnostics.length > 0}
              <div class="validation-diagnostics">
                {#each validationDiagnostics as diag}
                  <div class="val-item val-{diag.severity}">
                    <span class="val-path">{diag.path}</span>
                    <span class="val-msg">{diag.message}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}

        {:else if activeTab === 'auth'}
          <div class="auth-editor">
            <select bind:value={authType} onchange={saveState}>
              <option value="none">None</option>
              <option value="bearer">Bearer Token</option>
              <option value="apiKey">API Key</option>
              <option value="custom">Custom Header</option>
            </select>
            {#if authType === 'bearer'}
              <input type="text" placeholder="Token" bind:value={authToken} onchange={saveState} />
            {:else if authType === 'apiKey'}
              <input type="text" placeholder="Header name (e.g. X-API-Key)" bind:value={authHeaderName} onchange={saveState} />
              <input type="text" placeholder="API Key value" bind:value={authHeaderValue} onchange={saveState} />
            {:else if authType === 'custom'}
              <input type="text" placeholder="Header name" bind:value={authHeaderName} onchange={saveState} />
              <input type="text" placeholder="Header value" bind:value={authHeaderValue} onchange={saveState} />
            {/if}
          </div>
        {/if}
      </div>

      <!-- Response Panel -->
      {#if response || explorerState === 'sending'}
        <div class="response-panel">
          <div class="response-header">
            <span class="response-title">Response</span>
            {#if response}
              <span class="status-badge {statusBadgeClass}">{response.status}</span>
              <span class="duration">{response.durationMs}ms</span>
            {:else}
              <span class="sending-indicator">...</span>
            {/if}
          </div>

          {#if response}
            <div class="response-split">
              <div class="response-body">
                {#if response.status === 204}
                  <div class="empty-response">(empty response)</div>
                {:else if isJsonResponse}
                  <pre class="json-body">{formattedResponseBody}</pre>
                {:else if responseContentType.includes('text/')}
                  <pre class="text-body">{formattedResponseBody}</pre>
                {:else if response.status > 0}
                  <div class="binary-response">
                    Binary response ({responseContentType || 'unknown type'})
                  </div>
                {:else}
                  <pre class="error-body">{formattedResponseBody}</pre>
                {/if}
              </div>
            </div>

            <!-- Response Headers -->
            <details class="response-headers-section">
              <summary>Response Headers ({Object.keys(response.headers).length})</summary>
              <div class="response-headers-list">
                {#each Object.entries(response.headers) as [key, value]}
                  <div class="response-header-item">
                    <span class="header-key">{key}:</span>
                    <span class="header-value">{value}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        </div>
      {/if}

      <!-- Circuit Trace -->
      <!-- Batch Results (M206) -->
      {#if batchResults}
        <div class="batch-results">
          <div class="batch-header">
            <span class="batch-title">Batch Results</span>
            <span class="batch-stats">
              <span class="batch-passed">{batchResults.passed} passed</span>
              <span class="batch-failed">{batchResults.failed} failed</span>
              {#if batchResults.errors > 0}<span class="batch-errors">{batchResults.errors} error{batchResults.errors > 1 ? 's' : ''}</span>{/if}
              {#if batchResults.skipped > 0}<span class="batch-skipped">{batchResults.skipped} skipped</span>{/if}
            </span>
            <span class="duration">{batchResults.totalDurationMs}ms</span>
            <button class="icon-btn" onclick={() => batchResults = null} title="Close">x</button>
          </div>
          <div class="batch-table">
            {#each batchResults.results as row}
              <div class="batch-row batch-row-{row.status}" onclick={() => {
                const req = collectionRequests.find(r => r.id === row.requestId);
                if (req) selectCollectionRequest(req);
              }} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') { const req = collectionRequests.find(r => r.id === row.requestId); if (req) selectCollectionRequest(req); } }}>
                <span class="batch-status-badge batch-{row.status}">{row.status === 'passed' ? '\u2713' : row.status === 'failed' ? '\u2717' : row.status === 'error' ? '!' : '\u2212'}</span>
                <span class="batch-name">{row.requestName}</span>
                {#if row.responseStatus > 0}
                  <span class="batch-code">{row.responseStatus}</span>
                {/if}
                <span class="batch-dur">{row.durationMs}ms</span>
                {#if row.assertionsTotal > 0}
                  <span class="batch-asserts">{row.assertionsPassed}/{row.assertionsTotal}</span>
                {/if}
                {#if row.error}
                  <span class="batch-error-msg">{row.error}</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if timelineNodes.length > 0}
        <div class="circuit-trace">
          <div class="trace-title">Circuit Trace</div>
          {#each timelineNodes as node}
            <div class="trace-node" class:trace-error={node.outcome === 'error'}>
              <button class="trace-node-header" onclick={() => toggleTraceNode(node.nodeId)}>
                <span class="trace-expand">{expandedTraceNodes.has(node.nodeId) ? '&#9660;' : '&#9654;'}</span>
                <span class="outcome-badge outcome-{node.outcome}">{node.outcome}</span>
                <span class="trace-node-label" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); revealNodeSource(node.nodeId); }} onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); revealNodeSource(node.nodeId); } }}>{node.label}</span>
                <span class="trace-duration">{node.durationMs}ms</span>
              </button>
              {#if expandedTraceNodes.has(node.nodeId)}
                <div class="trace-node-detail">
                  {#if node.input !== undefined}
                    <div class="trace-payload">
                      <span class="payload-label">Input:</span>
                      <pre>{JSON.stringify(node.input, null, 2)}</pre>
                    </div>
                  {/if}
                  {#if node.output !== undefined}
                    <div class="trace-payload">
                      <span class="payload-label">Output:</span>
                      <pre>{JSON.stringify(node.output, null, 2)}</pre>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {:else if protocolMode === 'ws'}
      <!-- WebSocket Panel (M216) -->
      <div class="ws-panel">
        <div class="ws-url-bar">
          <input
            type="text"
            class="url-input"
            placeholder="ws://localhost:3111/ws/..."
            bind:value={wsUrl}
          />
          {#if wsState === 'connected'}
            <button class="send-btn disconnect-btn" onclick={wsDisconnect}>Disconnect</button>
          {:else}
            <button class="send-btn" onclick={wsConnect} disabled={wsState === 'connecting'}>
              {#if wsState === 'connecting'}Connecting...{:else}Connect{/if}
            </button>
          {/if}
        </div>

        <div class="ws-status-bar">
          <span class="connection-dot" class:connected={wsState === 'connected'} class:offline={wsState === 'disconnected' || wsState === 'error'}></span>
          <span class="connection-label">
            {#if wsState === 'connected'}Connected{:else if wsState === 'connecting'}Connecting...{:else if wsState === 'error'}Error{:else}Disconnected{/if}
          </span>
          <span class="ws-msg-count">{wsMessages.length} messages</span>
          <button class="icon-btn" onclick={wsClearLog} title="Clear">Clear</button>
        </div>

        <!-- Message Log -->
        <div class="ws-message-log">
          {#each wsMessages as msg}
            <div class="ws-msg" class:ws-sent={msg.direction === 'sent'} class:ws-received={msg.direction === 'received'}>
              <span class="ws-direction">{msg.direction === 'sent' ? '\u2191' : '\u2193'}</span>
              <span class="ws-time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
              <span class="ws-data">{msg.data}</span>
            </div>
          {/each}
          {#if wsMessages.length === 0}
            <div class="ws-empty">No messages yet. Connect to a WebSocket endpoint to begin.</div>
          {/if}
        </div>

        <!-- Send Input -->
        {#if wsState === 'connected'}
          <div class="ws-send-bar">
            <input
              type="text"
              class="url-input"
              placeholder="Type a message..."
              bind:value={wsInput}
              onkeydown={(e) => { if (e.key === 'Enter') wsSendMessage(); }}
            />
            <button class="send-btn" onclick={wsSendMessage}>Send</button>
          </div>
        {/if}
      </div>

      {:else if protocolMode === 'sse'}
      <!-- SSE Panel (M216) -->
      <div class="sse-panel">
        <div class="ws-url-bar">
          <input
            type="text"
            class="url-input"
            placeholder="http://localhost:3111/events"
            bind:value={sseUrl}
          />
          {#if sseState === 'connected'}
            <button class="send-btn disconnect-btn" onclick={sseDisconnect}>Disconnect</button>
          {:else}
            <button class="send-btn" onclick={sseConnect} disabled={sseState === 'connecting'}>
              {#if sseState === 'connecting'}Connecting...{:else}Connect{/if}
            </button>
          {/if}
        </div>

        <div class="ws-status-bar">
          <span class="connection-dot" class:connected={sseState === 'connected'} class:offline={sseState === 'disconnected' || sseState === 'error'}></span>
          <span class="connection-label">
            {#if sseState === 'connected'}Streaming{:else if sseState === 'connecting'}Connecting...{:else if sseState === 'error'}Error{:else}Disconnected{/if}
          </span>
          <span class="ws-msg-count">{sseEvents.length} events</span>
          <button class="icon-btn" onclick={sseClearLog} title="Clear">Clear</button>
        </div>

        <!-- Event Stream -->
        <div class="sse-event-log">
          <div class="sse-header-row">
            <span class="sse-col-type">Event Type</span>
            <span class="sse-col-data">Data</span>
            <span class="sse-col-time">Time</span>
          </div>
          {#each sseEvents as evt}
            <div class="sse-row">
              <span class="sse-col-type sse-type-badge">{evt.eventType}</span>
              <span class="sse-col-data sse-data-text">{evt.data || '(empty)'}</span>
              <span class="sse-col-time">{new Date(evt.timestamp).toLocaleTimeString()}</span>
            </div>
          {/each}
          {#if sseEvents.length === 0}
            <div class="ws-empty">No events yet. Connect to an SSE endpoint to begin.</div>
          {/if}
        </div>
      </div>
      {/if}
    </div>
  </div>

  <!-- Import Conflict Resolution Dialog (M205) -->
  {#if importConflicts.length > 0}
    <div class="conflict-overlay">
      <div class="conflict-dialog">
        <div class="conflict-title">Import Conflicts</div>
        <p class="conflict-desc">The following items already exist:</p>
        <ul class="conflict-list">
          {#each importConflicts as conflict}
            <li>
              <span class="conflict-type">{conflict.type}</span>
              <span class="conflict-name">{conflict.name}</span>
              {#if conflict.existingItemCount !== undefined}
                <span class="conflict-count">({conflict.existingItemCount} items)</span>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="conflict-actions">
          <button class="conflict-btn replace" onclick={() => resolveConflicts('replace')}>Replace All</button>
          <button class="conflict-btn skip" onclick={() => resolveConflicts('skip')}>Skip Conflicts</button>
          <button class="conflict-btn cancel" onclick={() => importConflicts = []}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .api-explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }

  /* ── Status Bar ── */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    font-size: 11px;
  }
  .connection-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vscode-charts-red);
  }
  .connection-dot.connected { background: var(--vscode-charts-green); }
  .connection-dot.cached { background: var(--vscode-charts-yellow); }
  .connection-label { opacity: 0.8; }
  .icon-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 4px;
    margin-left: auto;
    font-size: 14px;
  }
  .icon-btn:hover { color: var(--vscode-textLink-foreground); }

  /* ── Layout ── */
  .explorer-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Endpoint List (RequestList component) ── */
  .endpoint-list {
    width: 240px;
    min-width: 180px;
    border-right: 1px solid var(--vscode-sideBarSectionHeader-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Request/Response ── */
  .request-response {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 0;
  }

  /* URL Bar */
  .url-bar {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .url-bar select {
    padding: 4px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    font-size: 12px;
    font-weight: 600;
  }
  .url-input {
    flex: 1;
    padding: 4px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    font-size: 12px;
    outline: none;
  }
  .url-input:focus { border-color: var(--vscode-focusBorder); }
  .send-btn {
    padding: 4px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .send-btn:hover { background: var(--vscode-button-hoverBackground); }
  .send-btn:disabled { opacity: 0.5; cursor: default; }
  .save-btn {
    padding: 4px 8px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    cursor: pointer;
    font-size: 12px;
  }
  .save-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* Ingress Context */
  .ingress-context {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 11px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    background: var(--vscode-editorWidget-background);
  }
  .context-label { opacity: 0.6; }
  .context-value { font-weight: 600; }
  .circuit-link {
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: underline;
    font-weight: 600;
    font-size: inherit;
    padding: 0;
  }
  .circuit-link:hover { color: var(--vscode-textLink-activeForeground); }
  .template-btn {
    margin-left: auto;
    padding: 2px 8px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    cursor: pointer;
    font-size: 11px;
  }
  .template-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* Tabs */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .tab {
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    opacity: 0.7;
    border-bottom: 2px solid transparent;
  }
  .tab:hover { opacity: 1; }
  .tab.active {
    opacity: 1;
    border-bottom-color: var(--vscode-focusBorder);
  }

  .tab-content {
    padding: 8px;
    min-height: 100px;
  }

  /* Headers */
  .headers-editor { display: flex; flex-direction: column; gap: 4px; }
  .header-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .header-row input[type="text"] {
    flex: 1;
    padding: 3px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    font-size: 12px;
  }
  .header-row input[type="checkbox"] {
    width: 14px;
    height: 14px;
  }
  .remove-btn {
    background: none;
    border: none;
    color: var(--vscode-errorForeground);
    cursor: pointer;
    padding: 2px 4px;
  }
  .add-btn {
    background: none;
    border: 1px dashed var(--vscode-input-border);
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    padding: 4px 8px;
    font-size: 12px;
    margin-top: 4px;
  }

  /* Params */
  .params-info { font-size: 12px; }
  .hint { opacity: 0.6; margin-bottom: 8px; }
  .param-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .param-name { font-weight: 600; color: var(--vscode-charts-blue); }
  .param-row input {
    flex: 1;
    padding: 3px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    font-size: 12px;
  }

  /* Body Editor */
  .body-editor {
    width: 100%;
    min-height: 120px;
    padding: 6px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-input-border);
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    resize: vertical;
    outline: none;
  }
  .body-editor:focus { border-color: var(--vscode-focusBorder); }

  /* Auth */
  .auth-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .auth-editor select, .auth-editor input {
    padding: 4px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    font-size: 12px;
  }

  /* ── Response Panel ── */
  .response-panel {
    border-top: 2px solid var(--vscode-sideBarSectionHeader-border);
    padding: 0;
  }
  .response-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .response-title { font-weight: 600; font-size: 12px; }
  .status-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
  }
  .badge-success { background: var(--vscode-charts-green); color: #000; }
  .badge-error { background: var(--vscode-charts-red); color: #fff; }
  .badge-warning { background: var(--vscode-charts-yellow); color: #000; }
  .duration { font-size: 11px; opacity: 0.7; margin-left: auto; }
  .sending-indicator { opacity: 0.5; }

  .response-split { padding: 8px; }
  .response-body { overflow-x: auto; }
  .json-body, .text-body, .error-body {
    margin: 0;
    padding: 8px;
    background: var(--vscode-editor-background);
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    white-space: pre-wrap;
    word-break: break-word;
    border-radius: 3px;
    max-height: 300px;
    overflow: auto;
  }
  .error-body { color: var(--vscode-errorForeground); }
  .empty-response, .binary-response {
    padding: 16px;
    text-align: center;
    opacity: 0.6;
    font-size: 12px;
  }

  /* Response Headers */
  .response-headers-section {
    margin: 4px 8px;
    font-size: 12px;
  }
  .response-headers-section summary {
    cursor: pointer;
    opacity: 0.7;
    padding: 4px 0;
  }
  .response-header-item {
    display: flex;
    gap: 4px;
    padding: 1px 0;
    font-family: var(--vscode-editor-font-family);
    font-size: 11px;
  }
  .header-key { color: var(--vscode-charts-blue); }
  .header-value { opacity: 0.8; word-break: break-all; }

  /* ── Circuit Trace ── */
  .circuit-trace {
    border-top: 2px solid var(--vscode-sideBarSectionHeader-border);
    padding: 8px;
  }
  .trace-title {
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 6px;
  }
  .trace-node {
    border: 1px solid var(--vscode-sideBarSectionHeader-border);
    border-radius: 3px;
    margin-bottom: 4px;
    overflow: hidden;
  }
  .trace-node.trace-error {
    border-color: var(--vscode-charts-red);
  }
  .trace-node-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--vscode-editorWidget-background);
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-size: 12px;
  }
  .trace-expand { font-size: 10px; opacity: 0.6; }
  .outcome-badge {
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 10px;
    font-weight: 700;
  }
  .outcome-ok { background: var(--vscode-charts-green); color: #000; }
  .outcome-error { background: var(--vscode-charts-red); color: #fff; }
  .outcome-skipped { opacity: 0.5; }
  .trace-node-label {
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
    text-decoration: underline;
  }
  .trace-duration { margin-left: auto; opacity: 0.6; font-size: 11px; }
  .trace-node-detail { padding: 6px 8px; }
  .trace-payload { margin-bottom: 4px; }
  .payload-label { font-weight: 600; font-size: 11px; }
  .trace-payload pre {
    margin: 2px 0;
    padding: 4px;
    background: var(--vscode-editor-background);
    font-family: var(--vscode-editor-font-family);
    font-size: 11px;
    white-space: pre-wrap;
    max-height: 150px;
    overflow: auto;
  }

  /* ── M204: Environment picker ── */
  .env-separator { opacity: 0.3; margin: 0 2px; }
  .env-picker {
    padding: 1px 4px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    font-size: 11px;
    max-width: 100px;
  }

  /* ── M205: Export/Import ── */
  .export-import-group {
    display: flex;
    gap: 2px;
    align-items: center;
  }
  .export-dropdown-wrapper {
    position: relative;
  }
  .export-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
    border-radius: 3px;
    padding: 2px 0;
    min-width: 160px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  .export-dropdown button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 12px;
    background: none;
    border: none;
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    font-size: 12px;
    cursor: pointer;
  }
  .export-dropdown button:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
  }

  /* Conflict dialog */
  .conflict-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .conflict-dialog {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-sideBarSectionHeader-border));
    border-radius: 6px;
    padding: 16px;
    max-width: 360px;
    width: 90%;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  .conflict-title {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 8px;
  }
  .conflict-desc {
    font-size: 12px;
    opacity: 0.8;
    margin: 0 0 8px 0;
  }
  .conflict-list {
    list-style: none;
    padding: 0;
    margin: 0 0 12px 0;
    max-height: 150px;
    overflow-y: auto;
  }
  .conflict-list li {
    padding: 3px 0;
    font-size: 12px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .conflict-type {
    padding: 1px 4px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 2px;
    font-size: 10px;
    text-transform: uppercase;
  }
  .conflict-name { font-weight: 500; }
  .conflict-count { opacity: 0.6; font-size: 11px; }
  .conflict-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .conflict-btn {
    padding: 4px 12px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    border-radius: 3px;
  }
  .conflict-btn.replace {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .conflict-btn.replace:hover { background: var(--vscode-button-hoverBackground); }
  .conflict-btn.skip {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .conflict-btn.skip:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .conflict-btn.cancel {
    background: none;
    border: 1px solid var(--vscode-input-border);
    color: var(--vscode-foreground);
  }

  /* ── M206: Batch button ── */
  .batch-btn {
    padding: 4px 8px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    cursor: pointer;
    font-size: 12px;
  }
  .batch-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .batch-btn.cancel {
    background: var(--vscode-charts-red);
    color: #fff;
  }

  /* ── M206: Batch results ── */
  .batch-results {
    border-top: 2px solid var(--vscode-sideBarSectionHeader-border);
  }
  .batch-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    font-size: 12px;
  }
  .batch-title { font-weight: 600; }
  .batch-stats { display: flex; gap: 8px; font-size: 11px; }
  .batch-passed { color: var(--vscode-charts-green); }
  .batch-failed { color: var(--vscode-charts-red); }
  .batch-errors { color: var(--vscode-charts-orange); }
  .batch-skipped { opacity: 0.5; }
  .batch-table { padding: 4px 8px; }
  .batch-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 2px;
  }
  .batch-row:hover { background: var(--vscode-list-hoverBackground); }
  .batch-status-badge {
    width: 16px;
    text-align: center;
    font-weight: 700;
    font-size: 11px;
  }
  .batch-passed { color: var(--vscode-charts-green); }
  .batch-failed { color: var(--vscode-charts-red); }
  .batch-error { color: var(--vscode-charts-orange); }
  .batch-skipped { opacity: 0.5; }
  .batch-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .batch-code { font-weight: 600; font-size: 11px; }
  .batch-dur { opacity: 0.6; font-size: 11px; }
  .batch-asserts { font-size: 10px; padding: 1px 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 2px; }
  .batch-error-msg { color: var(--vscode-errorForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }

  /* ── M206: Body validation ── */
  .validation-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  .validation-summary { font-size: 11px; display: flex; gap: 8px; }
  .val-error { color: var(--vscode-charts-red); }
  .val-warning { color: var(--vscode-charts-orange); }
  .val-ok { color: var(--vscode-charts-green); }
  .validation-diagnostics {
    max-height: 100px;
    overflow-y: auto;
    margin-bottom: 4px;
    border: 1px solid var(--vscode-input-border);
    border-radius: 3px;
    padding: 4px;
  }
  .val-item {
    display: flex;
    gap: 6px;
    padding: 2px 0;
    font-size: 11px;
  }
  .val-item.val-error .val-path { color: var(--vscode-charts-red); }
  .val-item.val-warning .val-path { color: var(--vscode-charts-orange); }
  .val-item.val-info .val-path { color: var(--vscode-charts-blue); }
  .val-path { font-weight: 600; min-width: 80px; }
  .val-msg { opacity: 0.8; }

  /* ── M204: Preset bar ── */
  .preset-bar {
    display: flex;
    gap: 4px;
    padding: 0 0 4px 0;
    align-items: center;
  }
  .preset-bar select {
    flex: 1;
    padding: 2px 4px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    font-size: 11px;
  }

  /* ── M216: Protocol Tabs ── */
  .protocol-tabs {
    display: flex;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    background: var(--vscode-editorWidget-background);
  }
  .protocol-tab {
    padding: 4px 12px;
    border: none;
    background: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.6;
    border-bottom: 2px solid transparent;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .protocol-tab:hover { opacity: 1; }
  .protocol-tab.active {
    opacity: 1;
    border-bottom-color: var(--vscode-focusBorder);
  }
  .protocol-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vscode-charts-red);
  }
  .protocol-dot.connected { background: var(--vscode-charts-green); }

  /* ── M216: WebSocket Panel ── */
  .ws-panel, .sse-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
  .ws-url-bar {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .disconnect-btn {
    background: var(--vscode-charts-red) !important;
    color: #fff !important;
  }
  .ws-status-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 11px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .ws-msg-count {
    margin-left: auto;
    opacity: 0.6;
    font-size: 11px;
  }
  .ws-message-log {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
    min-height: 200px;
    max-height: 400px;
  }
  .ws-msg {
    display: flex;
    gap: 6px;
    padding: 3px 0;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family);
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .ws-sent .ws-direction { color: var(--vscode-charts-blue); }
  .ws-received .ws-direction { color: var(--vscode-charts-green); }
  .ws-direction { font-weight: 700; min-width: 12px; }
  .ws-time { opacity: 0.5; font-size: 11px; min-width: 70px; }
  .ws-data { word-break: break-all; flex: 1; }
  .ws-empty {
    padding: 16px;
    text-align: center;
    opacity: 0.5;
    font-size: 12px;
  }
  .ws-send-bar {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
  }

  /* ── M216: SSE Panel ── */
  .sse-event-log {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
    min-height: 200px;
    max-height: 400px;
  }
  .sse-header-row {
    display: flex;
    gap: 8px;
    padding: 4px 0;
    font-size: 11px;
    font-weight: 600;
    opacity: 0.6;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .sse-row {
    display: flex;
    gap: 8px;
    padding: 3px 0;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family);
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .sse-col-type { min-width: 80px; max-width: 120px; }
  .sse-col-data { flex: 1; word-break: break-all; }
  .sse-col-time { min-width: 70px; opacity: 0.5; font-size: 11px; }
  .sse-type-badge {
    padding: 1px 4px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 2px;
    font-size: 10px;
  }
  .sse-data-text { opacity: 0.8; }
</style>

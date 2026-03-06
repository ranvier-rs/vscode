<script lang="ts">
  import type {
    ApiEndpoint,
    CollectionRequest,
    CollectionMeta,
    HistoryEntry,
  } from '../../shared/types';

  // Props
  let {
    endpoints = [],
    collections = [],
    activeCollection = undefined as string | undefined,
    collectionRequests = [] as CollectionRequest[],
    historyEntries = [] as HistoryEntry[],
    workspaceInitialized = false,
    searchFilter = '',
    selectedIds = new Set<string>() as Set<string>,
    onSelectEndpoint = (_ep: ApiEndpoint) => {},
    onSelectRequest = (_req: CollectionRequest) => {},
    onToggleSelect = (_id: string) => {},
    onDeleteRequest = (_collectionName: string, _requestId: string) => {},
    onDuplicateRequest = (_collectionName: string, _requestId: string) => {},
    onRenameRequest = (_collectionName: string, _requestId: string) => {},
    onLoadCollection = (_name: string) => {},
    onCreateCollection = () => {},
    onDeleteCollection = (_name: string) => {},
    onLoadHistory = () => {},
    onInitWorkspace = () => {},
    onRefreshRoutes = () => {},
  }: {
    endpoints: ApiEndpoint[];
    collections: CollectionMeta[];
    activeCollection?: string;
    collectionRequests: CollectionRequest[];
    historyEntries: HistoryEntry[];
    workspaceInitialized: boolean;
    searchFilter: string;
    selectedIds: Set<string>;
    onSelectEndpoint: (ep: ApiEndpoint) => void;
    onSelectRequest: (req: CollectionRequest) => void;
    onToggleSelect: (id: string) => void;
    onDeleteRequest: (collectionName: string, requestId: string) => void;
    onDuplicateRequest: (collectionName: string, requestId: string) => void;
    onRenameRequest: (collectionName: string, requestId: string) => void;
    onLoadCollection: (name: string) => void;
    onCreateCollection: () => void;
    onDeleteCollection: (name: string) => void;
    onLoadHistory: () => void;
    onInitWorkspace: () => void;
    onRefreshRoutes: () => void;
  } = $props();

  // State
  let activeTab: 'saved' | 'discovered' | 'history' = $state('discovered');
  let groupBy: 'ingress' | 'collection' | 'flat' = $state('ingress');
  let sortBy: 'name' | 'modified' | 'status' | 'duration' = $state('name');
  let contextMenuTarget: string | null = $state(null);
  let contextMenuPos = $state({ x: 0, y: 0 });

  // Computed
  let filteredEndpoints = $derived(
    endpoints.filter((ep) => {
      if (!searchFilter) return true;
      const q = searchFilter.toLowerCase();
      return ep.method.toLowerCase().includes(q) ||
        ep.path.toLowerCase().includes(q) ||
        (ep.circuitName?.toLowerCase().includes(q) ?? false);
    })
  );

  let filteredRequests = $derived(
    collectionRequests.filter((req) => {
      if (!searchFilter) return true;
      const q = searchFilter.toLowerCase();
      return req.name.toLowerCase().includes(q) ||
        req.method.toLowerCase().includes(q) ||
        req.path.toLowerCase().includes(q);
    })
  );

  let sortedRequests = $derived(
    [...filteredRequests].sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'modified': return (b.lastExecutedAt ?? '').localeCompare(a.lastExecutedAt ?? '');
        case 'status': return (a.lastStatus ?? 0) - (b.lastStatus ?? 0);
        case 'duration': return (a.lastDurationMs ?? 0) - (b.lastDurationMs ?? 0);
        default: return 0;
      }
    })
  );

  let groupedEndpoints = $derived.by(() => {
    const groups: Record<string, ApiEndpoint[]> = {};
    for (const ep of filteredEndpoints) {
      const key = groupBy === 'flat' ? 'All' : ep.path;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ep);
    }
    return groups;
  });

  let groupedRequests = $derived.by(() => {
    const groups: Record<string, CollectionRequest[]> = {};
    for (const req of sortedRequests) {
      const key = groupBy === 'flat' ? 'All'
        : groupBy === 'ingress' ? `${req.method} ${req.path}`
        : activeCollection ?? 'Unsorted';
      if (!groups[key]) groups[key] = [];
      groups[key].push(req);
    }
    return groups;
  });

  let selectedCount = $derived(selectedIds.size);

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

  function statusBadge(status: number | undefined): string {
    if (!status) return '';
    if (status >= 200 && status < 300) return 'status-ok';
    if (status >= 400) return 'status-err';
    return 'status-warn';
  }

  function showContextMenu(e: MouseEvent, requestId: string) {
    e.preventDefault();
    contextMenuTarget = requestId;
    contextMenuPos = { x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    contextMenuTarget = null;
  }

  function handleContextAction(action: string) {
    if (!contextMenuTarget || !activeCollection) return;
    switch (action) {
      case 'duplicate':
        onDuplicateRequest(activeCollection, contextMenuTarget);
        break;
      case 'rename':
        onRenameRequest(activeCollection, contextMenuTarget);
        break;
      case 'delete':
        onDeleteRequest(activeCollection, contextMenuTarget);
        break;
    }
    closeContextMenu();
  }
</script>

<svelte:window onclick={closeContextMenu} />

<div class="request-list">
  <!-- Tab bar -->
  <div class="list-tabs">
    <button class="list-tab" class:active={activeTab === 'saved'} onclick={() => activeTab = 'saved'}>
      Saved {#if collectionRequests.length > 0}<span class="count-badge">{collectionRequests.length}</span>{/if}
    </button>
    <button class="list-tab" class:active={activeTab === 'discovered'} onclick={() => activeTab = 'discovered'}>
      Routes {#if endpoints.length > 0}<span class="count-badge">{endpoints.length}</span>{/if}
    </button>
    <button class="list-tab" class:active={activeTab === 'history'} onclick={() => activeTab = 'history'}>
      History
    </button>
  </div>

  <!-- Search + controls -->
  <div class="list-controls">
    <input
      type="text"
      class="search-input"
      placeholder="Filter..."
      bind:value={searchFilter}
    />
    {#if activeTab === 'saved' && selectedCount > 0}
      <span class="selection-badge">{selectedCount} selected</span>
    {/if}
  </div>

  <!-- Content area -->
  <div class="list-scroll">
    {#if activeTab === 'saved'}
      <!-- Collection picker -->
      {#if !workspaceInitialized}
        <div class="empty-state">
          <p>No .ranvier/ workspace found.</p>
          <button class="action-btn" onclick={onInitWorkspace}>Initialize Workspace</button>
        </div>
      {:else if collections.length === 0}
        <div class="empty-state">
          <p>No collections yet.</p>
          <button class="action-btn" onclick={onCreateCollection}>Create Collection</button>
        </div>
      {:else}
        <div class="collection-picker">
          <select
            value={activeCollection ?? ''}
            onchange={(e) => {
              const sel = /** @type {HTMLSelectElement} */ (e.currentTarget);
              if (sel.value) onLoadCollection(sel.value);
            }}
          >
            <option value="" disabled>Select collection...</option>
            {#each collections as col}
              <option value={col.name}>{col.name} ({col.requestCount})</option>
            {/each}
          </select>
          <button class="icon-btn" onclick={onCreateCollection} title="New collection">+</button>
        </div>

        <!-- Sort controls -->
        {#if activeCollection}
          <div class="sort-bar">
            <select bind:value={sortBy}>
              <option value="name">Name</option>
              <option value="modified">Last run</option>
              <option value="status">Status</option>
              <option value="duration">Duration</option>
            </select>
            <select bind:value={groupBy}>
              <option value="ingress">By path</option>
              <option value="collection">By collection</option>
              <option value="flat">Flat</option>
            </select>
          </div>
        {/if}

        <!-- Request items -->
        {#each Object.entries(groupedRequests) as [group, reqs]}
          <div class="endpoint-group">
            {#if groupBy !== 'flat'}
              <div class="group-path">{group}</div>
            {/if}
            {#each reqs as req}
              <div
                class="request-item"
                role="button"
                tabindex="0"
                onclick={() => onSelectRequest(req)}
                oncontextmenu={(e) => showContextMenu(e, req.id)}
                onkeydown={(e) => e.key === 'Enter' && onSelectRequest(req)}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(req.id)}
                  onclick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(req.id);
                  }}
                />
                <span class="method-badge" style="color: {methodColor(req.method)}">{req.method}</span>
                <span class="request-name">{req.name}</span>
                {#if req.lastStatus}
                  <span class="last-status {statusBadge(req.lastStatus)}">{req.lastStatus}</span>
                {/if}
                {#if req.lastDurationMs}
                  <span class="last-duration">{req.lastDurationMs}ms</span>
                {/if}
              </div>
            {/each}
          </div>
        {/each}

        {#if sortedRequests.length === 0 && activeCollection}
          <div class="empty-state">No saved requests yet. Send a request and save it.</div>
        {/if}
      {/if}

    {:else if activeTab === 'discovered'}
      <div class="route-controls">
        <button class="icon-btn" onclick={onRefreshRoutes} title="Refresh routes">&#x21bb;</button>
      </div>
      {#each Object.entries(groupedEndpoints) as [path, eps]}
        <div class="endpoint-group">
          <div class="group-path">{path}</div>
          {#each eps as ep}
            <button
              class="endpoint-item"
              onclick={() => onSelectEndpoint(ep)}
            >
              <span class="method-badge" style="color: {methodColor(ep.method)}">{ep.method}</span>
              <span class="endpoint-path">{ep.path}</span>
              {#if ep.circuitName}
                <span class="circuit-name">{ep.circuitName}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/each}
      {#if filteredEndpoints.length === 0}
        <div class="empty-state">No endpoints found</div>
      {/if}

    {:else if activeTab === 'history'}
      <div class="route-controls">
        <button class="icon-btn" onclick={onLoadHistory} title="Refresh history">&#x21bb;</button>
      </div>
      {#each historyEntries as entry}
        <div class="history-item">
          <span class="method-badge" style="color: {methodColor(entry.method)}">{entry.method}</span>
          <span class="history-path">{entry.path}</span>
          <span class="last-status {statusBadge(entry.status)}">{entry.status}</span>
          <span class="last-duration">{entry.durationMs}ms</span>
        </div>
      {/each}
      {#if historyEntries.length === 0}
        <div class="empty-state">No history yet</div>
      {/if}
    {/if}
  </div>

  <!-- Context menu -->
  {#if contextMenuTarget}
    <div class="context-menu" style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px;">
      <button onclick={() => handleContextAction('duplicate')}>Duplicate</button>
      <button onclick={() => handleContextAction('rename')}>Rename</button>
      <button class="danger" onclick={() => handleContextAction('delete')}>Delete</button>
    </div>
  {/if}
</div>

<style>
  .request-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
  }

  /* Tabs */
  .list-tabs {
    display: flex;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  }
  .list-tab {
    flex: 1;
    padding: 4px 2px;
    border: none;
    background: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 11px;
    opacity: 0.7;
    border-bottom: 2px solid transparent;
    text-align: center;
  }
  .list-tab:hover { opacity: 1; }
  .list-tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }
  .count-badge {
    display: inline-block;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    margin-left: 2px;
  }

  /* Controls */
  .list-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
  }
  .search-input {
    flex: 1;
    padding: 3px 6px;
    border: 1px solid var(--vscode-input-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 12px;
    outline: none;
  }
  .search-input:focus { border-color: var(--vscode-focusBorder); }
  .selection-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    white-space: nowrap;
  }

  /* Scroll area */
  .list-scroll {
    flex: 1;
    overflow-y: auto;
  }

  /* Collection picker */
  .collection-picker {
    display: flex;
    gap: 4px;
    padding: 4px;
  }
  .collection-picker select {
    flex: 1;
    padding: 3px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    font-size: 12px;
  }

  /* Sort bar */
  .sort-bar {
    display: flex;
    gap: 4px;
    padding: 2px 4px;
  }
  .sort-bar select {
    flex: 1;
    padding: 2px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    font-size: 11px;
  }

  /* Route controls */
  .route-controls {
    display: flex;
    justify-content: flex-end;
    padding: 2px 4px;
  }

  /* Endpoint/Request items */
  .endpoint-group { margin-bottom: 2px; }
  .group-path {
    padding: 2px 8px;
    font-size: 10px;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .endpoint-item, .request-item, .history-item {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    background: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    text-align: left;
    font-size: 12px;
  }
  .endpoint-item:hover, .request-item:hover, .history-item:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .method-badge {
    font-weight: 700;
    font-size: 10px;
    min-width: 36px;
    text-align: center;
  }
  .endpoint-path, .request-name, .history-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .circuit-name {
    font-size: 10px;
    opacity: 0.5;
    max-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .last-status {
    font-size: 10px;
    font-weight: 700;
    padding: 0 3px;
    border-radius: 2px;
  }
  .status-ok { color: var(--vscode-charts-green); }
  .status-err { color: var(--vscode-charts-red); }
  .status-warn { color: var(--vscode-charts-yellow); }
  .last-duration {
    font-size: 10px;
    opacity: 0.6;
  }

  .request-item input[type="checkbox"] {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  /* Empty state */
  .empty-state {
    padding: 16px 8px;
    text-align: center;
    opacity: 0.6;
    font-size: 12px;
  }
  .action-btn {
    margin-top: 8px;
    padding: 4px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    cursor: pointer;
    font-size: 12px;
  }
  .action-btn:hover { background: var(--vscode-button-hoverBackground); }

  .icon-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 14px;
  }
  .icon-btn:hover { color: var(--vscode-textLink-foreground); }

  /* Context menu */
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--vscode-menu-background);
    border: 1px solid var(--vscode-menu-border);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    padding: 4px 0;
    min-width: 120px;
  }
  .context-menu button {
    display: block;
    width: 100%;
    padding: 4px 12px;
    border: none;
    background: none;
    color: var(--vscode-menu-foreground);
    cursor: pointer;
    text-align: left;
    font-size: 12px;
  }
  .context-menu button:hover {
    background: var(--vscode-menu-selectionBackground);
    color: var(--vscode-menu-selectionForeground);
  }
  .context-menu button.danger { color: var(--vscode-errorForeground); }
</style>

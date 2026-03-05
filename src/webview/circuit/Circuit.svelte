<script lang="ts">
    import { writable } from "svelte/store";
    import { Background, BackgroundVariant, Controls, MiniMap, SvelteFlow, type Edge, type Node } from "@xyflow/svelte";
    import type { ExtensionToWebviewMessage, NodeDiagnosticsSummary, WebviewToExtensionMessage, CircuitNode, CircuitEdge, ServerConnectionState, HeatmapMode, NodeMetrics, InspectorEvent, StallInfo } from "../../shared/types";
    import { ExtensionToWebviewMessageSchema } from "../../shared/schemas";
    import { webviewTranslations, type TranslationDictionary } from "../i18n-data";
    import { theme, type Severity, getNodeTheme } from "../theme";

    declare function acquireVsCodeApi(): {
        postMessage: (message: WebviewToExtensionMessage) => void;
    };

    type NodeData = {
        label: string;
        sourceFile?: string;
        diagnosticsBadge?: string;
    };

    const vscode = acquireVsCodeApi();

    const nodes = writable<Node<NodeData>[]>([]);
    const edges = writable<Edge[]>([]);

    let sourceNodes: CircuitNode[] = [];
    let sourceEdges: CircuitEdge[] = [];
    let activeFile: string | undefined;
    let diagnosticsUpdatedAt: string | undefined;
    let focusedNodeId: string | undefined;
    let pendingRebuild = false;
    let locale: "en" | "ko" = "en";
    let statusMessage = "Loading circuit...";

    let translations: TranslationDictionary = webviewTranslations.en;
    let pausedNodeId: string | undefined;
    let activeTraceId: string | undefined;
    let serverState: ServerConnectionState = "disconnected";
    let serverUrl = "";
    let heatmapMode: HeatmapMode = "none";
    let nodeMetrics: Record<string, NodeMetrics> = {};
    let stalledNodeIds: Set<string> = new Set();

    // Event stream state
    const MAX_EVENTS = 200;
    let inspectorEvents: InspectorEvent[] = [];
    let showEventPanel = false;
    let eventFilterNode = "";
    let eventFilterType = "";
    let eventFilterText = "";

    $: filteredEvents = inspectorEvents.filter((e) => {
        if (eventFilterNode && e.nodeId !== eventFilterNode) return false;
        if (eventFilterType && e.eventType !== eventFilterType) return false;
        if (eventFilterText) {
            const text = eventFilterText.toLowerCase();
            const haystack = `${e.eventType} ${e.nodeId ?? ""} ${e.circuit ?? ""} ${e.outcomeType ?? ""}`.toLowerCase();
            if (!haystack.includes(text)) return false;
        }
        return true;
    });

    $: uniqueNodeIds = [...new Set(inspectorEvents.map((e) => e.nodeId).filter(Boolean))] as string[];
    $: uniqueEventTypes = [...new Set(inspectorEvents.map((e) => e.eventType))];

    function formatEventTime(ts: number): string {
        const d = new Date(ts);
        return d.toLocaleTimeString(locale, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) + "." + String(d.getMilliseconds()).padStart(3, "0");
    }

    function toggleEventPanel() {
        showEventPanel = !showEventPanel;
    }

    function clearEvents() {
        inspectorEvents = [];
    }

    function t() {
        return translations;
    }

    function format(template: string, ...args: (string | number | undefined)[]): string {
        return template.replace(/{(\d+)}/g, (match, number) => {
            const arg = args[parseInt(number, 10)];
            return arg !== undefined ? String(arg) : match;
        });
    }

    function normalizeLocale(value: string | undefined): "en" | "ko" {
        if (!value) {
            return "en";
        }
        return value.toLowerCase().startsWith("ko") ? "ko" : "en";
    }

    function normalizePath(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }
        return value.replaceAll("\\", "/");
    }

    function rebuildFlowNodes() {
        const normalizedActive = normalizePath(activeFile);
        nodes.set(
            sourceNodes.map((node) => {
                const sourceFile = normalizePath(node.sourceLocation?.file);
                const isActive = Boolean(sourceFile && normalizedActive && sourceFile === normalizedActive);
                const isFocused = focusedNodeId === node.id;
                const isPaused = pausedNodeId === node.id;
                const isStalled = stalledNodeIds.has(node.id);
                const badge = diagnosticsBadge(node.diagnostics);
                const hBadge = heatmapBadge(node.id);
                const severity = primarySeverity(node.diagnostics);
                const heatBorder = heatmapBorderColor(node.id);
                const labelParts = [node.label];
                if (badge) labelParts.push(badge);
                if (hBadge) labelParts.push(hBadge);
                if (isStalled) labelParts.push("[STALL]");
                return {
                    id: node.id,
                    position: node.position,
                    data: {
                        label: labelParts.join(" "),
                        sourceFile,
                        diagnosticsBadge: badge,
                    },
                    style: nodeStyle({
                        severity,
                        isActive: isActive || isFocused || isPaused || isStalled,
                        isFocused,
                        isPaused,
                        isStalled,
                        heatBorder,
                    }),
                } satisfies Node<NodeData>;
            }),
        );
    }

    function scheduleRebuildFlowNodes() {
        if (pendingRebuild) {
            return;
        }
        pendingRebuild = true;
        requestAnimationFrame(() => {
            pendingRebuild = false;
            rebuildFlowNodes();
        });
    }

    function rebuildFlowEdges() {
        edges.set(
            sourceEdges.map((edge) => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                label: edge.label,
            })),
        );
    }

    function applyInit(payload: ExtensionToWebviewMessage & { type: "init" }) {
        sourceNodes = payload.payload.nodes;
        sourceEdges = payload.payload.edges;
        activeFile = payload.payload.activeFile;
        diagnosticsUpdatedAt = payload.payload.diagnosticsUpdatedAt;
        locale = normalizeLocale(payload.payload.locale);
        if (payload.payload.translations) {
            translations = payload.payload.translations;
        }
        focusedNodeId = payload.payload.focusedNodeId;
        scheduleRebuildFlowNodes();
        rebuildFlowEdges();
        const mappedCount = sourceNodes.filter((item) => item.sourceLocation?.file).length;
        const diagnosticCount = sourceNodes.reduce((sum, node) => sum + (node.diagnostics?.items.length ?? 0), 0);
        const diagnosticsNote =
            diagnosticCount > 0
                ? format(t().circuit.diagnosticsNote, diagnosticCount, diagnosticsUpdatedAt ? format(t().circuit.diagnosticsTime, new Date(diagnosticsUpdatedAt).toLocaleTimeString(locale)) : "")
                : "";
        statusMessage = format(t().circuit.loaded, sourceNodes.length, mappedCount, diagnosticsNote);
    }

    function handleMessage(event: MessageEvent<unknown>) {
        const result = ExtensionToWebviewMessageSchema.safeParse(event.data);
        if (!result.success) {
            console.error("Invalid message from extension:", result.error);
            return;
        }
        const message = result.data;

        if (message.type === "init") {
            applyInit(message);
            return;
        }

        if (message.type === "highlight-by-file") {
            const nextActive = message.payload.activeFile;
            if (nextActive === activeFile) {
                return;
            }
            activeFile = nextActive;
            scheduleRebuildFlowNodes();
            return;
        }

        if (message.type === "highlight-node") {
            const nextFocused = message.payload.nodeId;
            if (nextFocused === focusedNodeId) {
                return;
            }
            focusedNodeId = nextFocused;
            scheduleRebuildFlowNodes();
            return;
        }

        if (message.type === "export-result") {
            statusMessage = message.payload.message;
            return;
        }

        if (message.type === "execution-paused") {
            pausedNodeId = message.payload.nodeId;
            activeTraceId = message.payload.traceId;
            statusMessage = `Execution paused at ${pausedNodeId} (trace: ${activeTraceId})`;
            scheduleRebuildFlowNodes();
            return;
        }

        if (message.type === "execution-resumed") {
            if (activeTraceId === message.payload.traceId) {
                pausedNodeId = undefined;
                activeTraceId = undefined;
                statusMessage = "Execution resumed";
                scheduleRebuildFlowNodes();
            }
            return;
        }

        if (message.type === "server-status") {
            serverState = message.payload.state;
            serverUrl = message.payload.url;
            if (message.payload.state !== "connected") {
                stalledNodeIds = new Set();
            }
            return;
        }

        if (message.type === "metrics-update") {
            // Merge all circuit metrics into a single flat node map
            const merged: Record<string, NodeMetrics> = {};
            for (const circuit of message.payload.circuits) {
                for (const [nodeId, m] of Object.entries(circuit.nodes)) {
                    merged[nodeId] = m;
                }
            }
            nodeMetrics = merged;
            if (heatmapMode !== "none") {
                scheduleRebuildFlowNodes();
            }
            return;
        }

        if (message.type === "inspector-event") {
            const ev = message.payload.event;
            inspectorEvents = [ev, ...inspectorEvents].slice(0, MAX_EVENTS);
            return;
        }

        if (message.type === "stall-detected") {
            const newStalled = new Set(message.payload.stalls.map((s) => s.nodeId));
            if (stalledNodeIds.size !== newStalled.size || [...newStalled].some((id) => !stalledNodeIds.has(id))) {
                stalledNodeIds = newStalled;
                scheduleRebuildFlowNodes();
            }
            return;
        }
    }

    function onNodeClick(event: CustomEvent<{ node: Node<NodeData> }>) {
        const id = event.detail.node.id;
        const found = sourceNodes.find((item) => item.id === id);
        if (!found?.sourceLocation?.file) {
            statusMessage = format(t().circuit.noSourceMapping, id);
            return;
        }
        statusMessage = format(t().circuit.jumping, found.sourceLocation.file, found.sourceLocation.line ?? 1);
        vscode.postMessage({
            type: "node-click",
            payload: { id },
        });
    }

    function onNodeDragStop(event: CustomEvent<{ node: Node<NodeData> }>) {
        const { node } = event.detail;
        vscode.postMessage({
            type: "update-node-layout",
            payload: {
                nodeId: node.id,
                x: node.position.x,
                y: node.position.y,
            },
        });
    }

    function onDragOver(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    }

    function onDrop(event: DragEvent) {
        event.preventDefault();

        const label = event.dataTransfer?.getData("application/vnd.ranvier.label") || event.dataTransfer?.getData("text/plain");
        const snippet = event.dataTransfer?.getData("application/vnd.code.snippet");

        if (!label || !snippet) return;

        // Calculate position relative to the flow view
        const target = event.target as HTMLElement;
        const bounds = target.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;

        vscode.postMessage({
            type: "add-transition-node",
            payload: {
                label,
                snippet,
                x,
                y,
            },
        });
    }

    function runSchematicExport() {
        statusMessage = t().circuit.runningExport;
        vscode.postMessage({
            type: "run-schematic-export",
        });
    }

    function refreshDiagnostics() {
        statusMessage = t().circuit.refreshingDiagnostics;
        vscode.postMessage({
            type: "refresh-diagnostics",
        });
    }

    function debugResume() {
        if (!activeTraceId) return;
        vscode.postMessage({
            type: "debug-resume",
            payload: { traceId: activeTraceId },
        });
    }

    function debugStep() {
        if (!activeTraceId) return;
        vscode.postMessage({
            type: "debug-step",
            payload: { traceId: activeTraceId },
        });
    }

    function debugPause() {
        // This is a bit more complex as we need to know what to pause,
        // but for now let's assume global pause if implemented by extension
        // or just placeholder for future.
    }

    function primarySeverity(diagnostics: NodeDiagnosticsSummary | undefined): Severity {
        if (!diagnostics) {
            return "none";
        }
        if (diagnostics.error > 0) {
            return "error";
        }
        if (diagnostics.warning > 0) {
            return "warning";
        }
        if (diagnostics.info > 0) {
            return "info";
        }
        return "none";
    }

    function diagnosticsBadge(diagnostics: NodeDiagnosticsSummary | undefined): string | undefined {
        if (!diagnostics) {
            return undefined;
        }
        const chunks: string[] = [];
        if (diagnostics.error > 0) {
            chunks.push(`E${diagnostics.error}`);
        }
        if (diagnostics.warning > 0) {
            chunks.push(`W${diagnostics.warning}`);
        }
        if (diagnostics.info > 0) {
            chunks.push(`I${diagnostics.info}`);
        }
        return chunks.length > 0 ? `[${chunks.join("/")}]` : undefined;
    }

    /** Map a 0..1 ratio to a green→yellow→red color. */
    function heatColor(ratio: number): string {
        const clamped = Math.max(0, Math.min(1, ratio));
        if (clamped <= 0.5) {
            // green → yellow
            const t = clamped * 2;
            const r = Math.round(115 + t * (204 - 115));
            const g = Math.round(201 - t * (201 - 167));
            return `rgb(${r}, ${g}, 0)`;
        }
        // yellow → red
        const t = (clamped - 0.5) * 2;
        const r = Math.round(204 + t * (241 - 204));
        const g = Math.round(167 - t * 167);
        return `rgb(${r}, ${g}, 0)`;
    }

    function heatmapBorderColor(nodeId: string): string | undefined {
        const m = nodeMetrics[nodeId];
        if (!m || heatmapMode === "none") return undefined;
        if (heatmapMode === "traffic") {
            // Normalize throughput: 0 → green, 100+ → red
            return heatColor(Math.min(m.throughput / 100, 1));
        }
        if (heatmapMode === "latency") {
            // Normalize p95: 0ms → green, 1000ms+ → red
            return heatColor(Math.min(m.latencyP95 / 1000, 1));
        }
        if (heatmapMode === "errors") {
            return heatColor(m.errorRate);
        }
        return undefined;
    }

    function heatmapBadge(nodeId: string): string | undefined {
        const m = nodeMetrics[nodeId];
        if (!m || m.sampleCount === 0 || heatmapMode === "none") return undefined;
        if (heatmapMode === "traffic") return `${m.throughput}/s`;
        if (heatmapMode === "latency") return `p95:${Math.round(m.latencyP95)}ms`;
        if (heatmapMode === "errors") return m.errorCount > 0 ? `${(m.errorRate * 100).toFixed(0)}%err` : undefined;
        return undefined;
    }

    function toggleHeatmap() {
        const modes: HeatmapMode[] = ["none", "traffic", "latency", "errors"];
        const idx = modes.indexOf(heatmapMode);
        heatmapMode = modes[(idx + 1) % modes.length] as HeatmapMode;
        scheduleRebuildFlowNodes();
    }

    function nodeStyle(input: { severity: Severity; isActive: boolean; isFocused: boolean; isPaused?: boolean; isStalled?: boolean; heatBorder?: string }): string {
        const palette = getNodeTheme(input.severity);
        const stallColor = "var(--vscode-testing-iconFailed, #f14c4c)";
        const borderColor = input.isStalled ? stallColor : input.heatBorder ?? palette.border;
        const styles = [
            `border: ${input.isActive ? `2px solid ${borderColor}` : `1px solid ${borderColor}`}`,
            `background: ${palette.background}`,
            `color: ${theme.foreground}`,
            `border-radius: var(--ranvier-node-radius)`,
            `box-shadow: ${input.isStalled ? `0 0 15px ${stallColor}` : input.isPaused ? `0 0 15px var(--vscode-debugIcon-pauseForeground)` : input.heatBorder ? `0 0 8px ${input.heatBorder}40` : input.isFocused ? `0 0 0 2px ${theme.focusBorder}, 0 4px 10px rgba(0,0,0,0.1)` : input.isActive ? `0 4px 8px rgba(0,0,0,0.1)` : "none"}`,
            `font-weight: ${input.isActive ? "700" : "400"}`,
            input.isPaused ? `outline: 2px solid var(--vscode-debugIcon-pauseForeground); outline-offset: 2px` : "",
            input.isStalled ? `animation: stall-pulse 1.5s ease-in-out infinite` : "",
        ];
        return styles.filter(Boolean).join(";");
    }

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });
</script>

<main class="shell">
    <header class="toolbar">
        <div class="left">
            <div class="title">{t().circuit.title}</div>
            <button class="export" on:click={runSchematicExport}>{t().circuit.export}</button>
            <button class="diagnostics" on:click={refreshDiagnostics}>{t().circuit.refresh}</button>
            {#if serverState === "connected"}
                <button class="heatmap-toggle" class:active={heatmapMode !== "none"} on:click={toggleHeatmap} title="Heatmap: {heatmapMode}">
                    {heatmapMode === "none" ? "Heatmap" : heatmapMode === "traffic" ? "Traffic" : heatmapMode === "latency" ? "Latency" : "Errors"}
                </button>
                <button class="event-panel-toggle" class:active={showEventPanel} on:click={toggleEventPanel} title="Toggle event stream">
                    Events{inspectorEvents.length > 0 ? ` (${inspectorEvents.length})` : ""}
                </button>
            {/if}
        </div>
        {#if activeTraceId}
            <div class="debug-controls">
                <button class="debug-resume" title="Continue (F5)" on:click={debugResume}>
                    <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M4.5 3L13 8L4.5 13V3Z" /></svg>
                </button>
                <button class="debug-step" title="Step Over (F10)" on:click={debugStep}>
                    <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M12.5 4H14V13H12.5V4ZM2.5 4.5L7.5 8L2.5 11.5V4.5ZM7.5 4.5L12.5 8L7.5 11.5V4.5Z" /></svg>
                </button>
            </div>
        {/if}
        <div class="hint">{statusMessage}</div>
        <div class="server-status" class:connected={serverState === "connected"} class:error={serverState === "error"} class:connecting={serverState === "connecting"} title="{serverState === 'connected' ? serverUrl : serverState === 'error' ? 'Connection failed — retrying' : serverState === 'connecting' ? 'Connecting...' : 'No server'}">
            <span class="status-dot"></span>
            <span class="status-label">{serverState === "connected" ? "Live" : serverState === "connecting" ? "..." : serverState === "error" ? "Offline" : ""}</span>
        </div>
    </header>

    <section class="canvas" on:dragover={onDragOver} on:drop={onDrop} role="application">
        <SvelteFlow {nodes} {edges} fitView on:nodeclick={onNodeClick} on:nodedragstop={onNodeDragStop}>
            <Controls />
            <MiniMap />
            <Background variant={BackgroundVariant.Dots} />
        </SvelteFlow>
    </section>

    {#if showEventPanel}
        <section class="event-panel">
            <div class="event-panel-header">
                <span class="event-panel-title">Event Stream</span>
                <div class="event-filters">
                    <select bind:value={eventFilterNode} class="event-filter-select" title="Filter by node">
                        <option value="">All nodes</option>
                        {#each uniqueNodeIds as nid}
                            <option value={nid}>{nid}</option>
                        {/each}
                    </select>
                    <select bind:value={eventFilterType} class="event-filter-select" title="Filter by event type">
                        <option value="">All types</option>
                        {#each uniqueEventTypes as et}
                            <option value={et}>{et}</option>
                        {/each}
                    </select>
                    <input type="text" bind:value={eventFilterText} placeholder="Search..." class="event-filter-input" />
                </div>
                <button class="event-clear" on:click={clearEvents} title="Clear events">Clear</button>
            </div>
            <div class="event-list">
                {#each filteredEvents as ev (ev.timestamp + ev.eventType + (ev.nodeId ?? ''))}
                    <div class="event-row" class:is-error={ev.outcomeType === 'Fault'}>
                        <span class="event-time">{formatEventTime(ev.timestamp)}</span>
                        <span class="event-type" class:node-exit={ev.eventType === 'node_exit'} class:node-enter={ev.eventType === 'node_enter'} class:circuit-exit={ev.eventType === 'circuit_exit'}>{ev.eventType}</span>
                        {#if ev.nodeId}
                            <span class="event-node">{ev.nodeId}</span>
                        {/if}
                        {#if ev.durationMs !== undefined}
                            <span class="event-duration">{ev.durationMs}ms</span>
                        {/if}
                        {#if ev.outcomeType}
                            <span class="event-outcome" class:fault={ev.outcomeType === 'Fault'}>{ev.outcomeType}</span>
                        {/if}
                        {#if ev.circuit}
                            <span class="event-circuit">{ev.circuit}</span>
                        {/if}
                    </div>
                {:else}
                    <div class="event-empty">No events{eventFilterNode || eventFilterType || eventFilterText ? " matching filters" : ""}</div>
                {/each}
            </div>
        </section>
    {/if}
</main>

<style>
    .shell {
        width: 100%;
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        background-color: var(--vscode-editor-background);
    }

    .shell:has(.event-panel) {
        grid-template-rows: auto 1fr auto;
    }

    .toolbar {
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        align-items: center;
        border-bottom: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editorWidget-background);
        gap: 16px;
    }

    .title {
        font-size: 13px;
        font-weight: 700;
        color: var(--vscode-foreground);
        letter-spacing: 0.02em;
        white-space: nowrap;
    }

    .left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }

    .export {
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 4px; /* Standard VSCode radius */
        cursor: pointer;
        font-weight: 400;
    }

    .export:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .diagnostics {
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 400;
    }

    .diagnostics:hover {
        background: var(--vscode-button-hoverBackground);
    }

    .hint {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .debug-controls {
        display: flex;
        gap: 4px;
        background: var(--vscode-debugToolBar-background);
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid var(--vscode-debugToolBar-border);
    }

    .debug-controls button {
        background: transparent;
        border: none;
        color: var(--vscode-debugIcon-continueForeground);
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        border-radius: 2px;
    }

    .debug-controls button:hover {
        background: var(--vscode-toolbar-hoverBackground);
    }

    .debug-controls button.debug-step {
        color: var(--vscode-debugIcon-stepOverForeground);
    }

    .heatmap-toggle {
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 400;
    }

    .heatmap-toggle:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .heatmap-toggle.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }

    .canvas {
        min-height: 0;
    }

    .server-status {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        padding: 2px 8px;
        border-radius: 4px;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .status-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--vscode-descriptionForeground);
        opacity: 0.4;
    }

    .server-status.connected .status-dot {
        background: var(--vscode-testing-iconPassed, #73c991);
        opacity: 1;
    }

    .server-status.error .status-dot {
        background: var(--vscode-testing-iconFailed, #f14c4c);
        opacity: 1;
    }

    .server-status.connecting .status-dot {
        background: var(--vscode-editorWarning-foreground, #cca700);
        opacity: 1;
        animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
    }

    @keyframes -global-stall-pulse {
        0%, 100% { box-shadow: 0 0 8px var(--vscode-testing-iconFailed, #f14c4c); }
        50% { box-shadow: 0 0 20px var(--vscode-testing-iconFailed, #f14c4c); }
    }

    .status-label {
        font-weight: 500;
    }

    .server-status.connected .status-label {
        color: var(--vscode-testing-iconPassed, #73c991);
    }

    .server-status.error .status-label {
        color: var(--vscode-testing-iconFailed, #f14c4c);
    }

    .event-panel-toggle {
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 400;
    }

    .event-panel-toggle:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .event-panel-toggle.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }

    .event-panel {
        border-top: 1px solid var(--vscode-panel-border);
        background: var(--vscode-panel-background, var(--vscode-editor-background));
        display: flex;
        flex-direction: column;
        max-height: 220px;
        min-height: 100px;
    }

    .event-panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        border-bottom: 1px solid var(--vscode-panel-border);
        flex-shrink: 0;
    }

    .event-panel-title {
        font-size: 11px;
        font-weight: 600;
        color: var(--vscode-foreground);
        white-space: nowrap;
    }

    .event-filters {
        display: flex;
        gap: 4px;
        flex: 1;
        min-width: 0;
    }

    .event-filter-select,
    .event-filter-input {
        font-size: 11px;
        padding: 2px 4px;
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border-radius: 3px;
        outline: none;
    }

    .event-filter-select {
        max-width: 120px;
    }

    .event-filter-input {
        flex: 1;
        min-width: 60px;
        max-width: 160px;
    }

    .event-filter-input:focus,
    .event-filter-select:focus {
        border-color: var(--vscode-focusBorder);
    }

    .event-clear {
        font-size: 11px;
        padding: 2px 6px;
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border-radius: 3px;
        cursor: pointer;
        white-space: nowrap;
    }

    .event-clear:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .event-list {
        overflow-y: auto;
        flex: 1;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 11px;
    }

    .event-row {
        display: flex;
        gap: 8px;
        padding: 2px 10px;
        border-bottom: 1px solid var(--vscode-widget-border, transparent);
        align-items: baseline;
    }

    .event-row:hover {
        background: var(--vscode-list-hoverBackground);
    }

    .event-row.is-error {
        background: var(--vscode-inputValidation-errorBackground, rgba(241, 76, 76, 0.1));
    }

    .event-time {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        flex-shrink: 0;
    }

    .event-type {
        font-weight: 600;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .event-type.node-exit {
        color: var(--vscode-charts-blue, #3794ff);
    }

    .event-type.node-enter {
        color: var(--vscode-charts-green, #73c991);
    }

    .event-type.circuit-exit {
        color: var(--vscode-charts-purple, #b180d7);
    }

    .event-node {
        color: var(--vscode-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 120px;
    }

    .event-duration {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        flex-shrink: 0;
    }

    .event-outcome {
        font-size: 10px;
        padding: 0 4px;
        border-radius: 2px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        white-space: nowrap;
        flex-shrink: 0;
    }

    .event-outcome.fault {
        background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        color: var(--vscode-errorForeground, #f14c4c);
    }

    .event-circuit {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    .event-empty {
        padding: 12px 10px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        text-align: center;
    }
</style>

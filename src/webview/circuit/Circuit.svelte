<script lang="ts">
    import { writable } from "svelte/store";
    import { Background, BackgroundVariant, Controls, MiniMap, SvelteFlow, type Edge, type Node } from "@xyflow/svelte";
    import type { ExtensionToWebviewMessage, NodeDiagnosticsSummary, WebviewToExtensionMessage, CircuitNode, CircuitEdge } from "../../shared/types";
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
                const badge = diagnosticsBadge(node.diagnostics);
                const severity = primarySeverity(node.diagnostics);
                return {
                    id: node.id,
                    position: node.position,
                    data: {
                        label: badge ? `${node.label} ${badge}` : node.label,
                        sourceFile,
                        diagnosticsBadge: badge,
                    },
                    style: nodeStyle({
                        severity,
                        isActive: isActive || isFocused,
                        isFocused,
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

    function nodeStyle(input: { severity: Severity; isActive: boolean; isFocused: boolean }): string {
        const palette = getNodeTheme(input.severity);
        const styles = [
            `border: ${input.isActive ? `2px solid ${palette.border}` : `1px solid ${palette.border}`}`,
            `background: ${palette.background}`,
            `color: ${theme.foreground}`,
            `border-radius: var(--ranvier-node-radius)`,
            `box-shadow: ${input.isFocused ? `0 0 0 2px ${theme.focusBorder}, 0 4px 10px rgba(0,0,0,0.1)` : input.isActive ? `0 4px 8px rgba(0,0,0,0.1)` : "none"}`,
            `font-weight: ${input.isActive ? "700" : "400"}`,
        ];
        return styles.join(";");
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
        </div>
        <div class="hint">{statusMessage}</div>
    </header>

    <section class="canvas" on:dragover={onDragOver} on:drop={onDrop} role="application">
        <SvelteFlow {nodes} {edges} fitView on:nodeclick={onNodeClick} on:nodedragstop={onNodeDragStop}>
            <Controls />
            <MiniMap />
            <Background variant={BackgroundVariant.Dots} />
        </SvelteFlow>
    </section>
</main>

<style>
    .shell {
        width: 100%;
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        grid-template-rows: auto 1fr;
        background-color: var(--vscode-editor-background);
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

    .canvas {
        min-height: 0;
    }
</style>

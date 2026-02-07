<script lang="ts">
  import { writable } from 'svelte/store';
  import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    SvelteFlow,
    type Edge,
    type Node
  } from '@xyflow/svelte';
  import type {
    CircuitEdge,
    CircuitNode,
    ExtensionToWebviewMessage,
    NodeDiagnosticsSummary,
    WebviewToExtensionMessage
  } from '../shared/types';

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
  let locale: 'en' | 'ko' = 'en';
  let statusMessage = 'Loading circuit...';

  const copy = {
    en: {
      title: 'Ranvier Circuit View',
      runExport: 'Run Schematic Export',
      refreshDiagnostics: 'Refresh Diagnostics',
      loading: 'Loading circuit...',
      loaded: (nodesCount: number, mappedCount: number, diagnosticsNote: string) =>
        `Loaded ${nodesCount} nodes (${mappedCount} mapped${diagnosticsNote})`,
      diagnosticsNote: (diagnosticCount: number, updatedAt: string | undefined) =>
        `, ${diagnosticCount} diagnostics${
          updatedAt ? ` (updated ${new Date(updatedAt).toLocaleTimeString('en-US')})` : ''
        }`,
      noSourceMapping: (id: string) => `Node "${id}" has no source mapping`,
      jumping: (file: string, line: number) => `Jumping to ${file}:${line}`,
      runningExport: 'Running Ranvier schematic export...',
      refreshingDiagnostics: 'Refreshing diagnostics...'
    },
    ko: {
      title: 'Ranvier 회로 뷰',
      runExport: 'Schematic Export 실행',
      refreshDiagnostics: '진단 새로고침',
      loading: '회로를 불러오는 중...',
      loaded: (nodesCount: number, mappedCount: number, diagnosticsNote: string) =>
        `노드 ${nodesCount}개 로드됨 (매핑 ${mappedCount}개${diagnosticsNote})`,
      diagnosticsNote: (diagnosticCount: number, updatedAt: string | undefined) =>
        `, 진단 ${diagnosticCount}개${
          updatedAt ? ` (업데이트 ${new Date(updatedAt).toLocaleTimeString('ko-KR')})` : ''
        }`,
      noSourceMapping: (id: string) => `노드 "${id}"에 소스 매핑이 없습니다`,
      jumping: (file: string, line: number) => `${file}:${line} 로 이동 중`,
      runningExport: 'Ranvier schematic export 실행 중...',
      refreshingDiagnostics: '진단 정보를 새로고침하는 중...'
    }
  } as const;

  function t() {
    return copy[locale] ?? copy.en;
  }

  function normalizeLocale(value: string | undefined): 'en' | 'ko' {
    if (!value) {
      return 'en';
    }
    return value.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  }

  function normalizePath(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    return value.replaceAll('\\', '/');
  }

  function rebuildFlowNodes() {
    const normalizedActive = normalizePath(activeFile);
    nodes.set(
      sourceNodes.map((node) => {
        const sourceFile = normalizePath(node.sourceLocation?.file);
        const isActive = Boolean(sourceFile && normalizedActive && sourceFile === normalizedActive);
        const badge = diagnosticsBadge(node.diagnostics);
        const severity = primarySeverity(node.diagnostics);
        return {
          id: node.id,
          position: node.position,
          data: {
            label: badge ? `${node.label} ${badge}` : node.label,
            sourceFile,
            diagnosticsBadge: badge
          },
          style: nodeStyle({ severity, isActive })
        } satisfies Node<NodeData>;
      })
    );
  }

  function rebuildFlowEdges() {
    edges.set(
      sourceEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label
      }))
    );
  }

  function applyInit(payload: ExtensionToWebviewMessage & { type: 'init' }) {
    sourceNodes = payload.payload.nodes;
    sourceEdges = payload.payload.edges;
    activeFile = payload.payload.activeFile;
    diagnosticsUpdatedAt = payload.payload.diagnosticsUpdatedAt;
    locale = normalizeLocale(payload.payload.locale);
    rebuildFlowNodes();
    rebuildFlowEdges();
    const mappedCount = sourceNodes.filter((item) => item.sourceLocation?.file).length;
    const diagnosticCount = sourceNodes.reduce(
      (sum, node) => sum + (node.diagnostics?.items.length ?? 0),
      0
    );
    const diagnosticsNote =
      diagnosticCount > 0
        ? t().diagnosticsNote(diagnosticCount, diagnosticsUpdatedAt)
        : '';
    statusMessage = t().loaded(sourceNodes.length, mappedCount, diagnosticsNote);
  }

  function handleMessage(event: MessageEvent<ExtensionToWebviewMessage>) {
    if (event.data.type === 'init') {
      applyInit(event.data);
      return;
    }

    if (event.data.type === 'highlight-by-file') {
      activeFile = event.data.payload.activeFile;
      rebuildFlowNodes();
      return;
    }

    if (event.data.type === 'export-result') {
      statusMessage = event.data.payload.message;
    }
  }

  function onNodeClick(event: CustomEvent<{ node: Node<NodeData> }>) {
    const id = event.detail.node.id;
    const found = sourceNodes.find((item) => item.id === id);
    if (!found?.sourceLocation?.file) {
      statusMessage = t().noSourceMapping(id);
      return;
    }
    statusMessage = t().jumping(found.sourceLocation.file, found.sourceLocation.line ?? 1);
    vscode.postMessage({
      type: 'node-click',
      payload: { id }
    });
  }

  function runSchematicExport() {
    statusMessage = t().runningExport;
    vscode.postMessage({
      type: 'run-schematic-export'
    });
  }

  function refreshDiagnostics() {
    statusMessage = t().refreshingDiagnostics;
    vscode.postMessage({
      type: 'refresh-diagnostics'
    });
  }

  function primarySeverity(
    diagnostics: NodeDiagnosticsSummary | undefined
  ): 'error' | 'warning' | 'info' | 'none' {
    if (!diagnostics) {
      return 'none';
    }
    if (diagnostics.error > 0) {
      return 'error';
    }
    if (diagnostics.warning > 0) {
      return 'warning';
    }
    if (diagnostics.info > 0) {
      return 'info';
    }
    return 'none';
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
    return chunks.length > 0 ? `[${chunks.join('/')}]` : undefined;
  }

  function nodeStyle(input: {
    severity: 'error' | 'warning' | 'info' | 'none';
    isActive: boolean;
  }): Record<string, string> {
    const paletteBySeverity = {
      error: { border: '#d84343', background: '#fff0f0' },
      warning: { border: '#de8a21', background: '#fff6e8' },
      info: { border: '#2f6fca', background: '#eef5ff' },
      none: { border: '#98a3b8', background: '#ffffff' }
    } as const;

    const palette = paletteBySeverity[input.severity];
    return {
      border: input.isActive ? `2px solid ${palette.border}` : `1px solid ${palette.border}`,
      background: palette.background,
      color: '#1f2a3a',
      borderRadius: '10px',
      boxShadow: input.isActive
        ? '0 8px 18px rgba(44, 70, 110, 0.22)'
        : '0 4px 10px rgba(31, 42, 58, 0.08)',
      fontWeight: input.isActive ? '700' : '500'
    };
  }

  window.addEventListener('message', handleMessage);
  vscode.postMessage({ type: 'ready' });
</script>

<main class="shell">
  <header class="toolbar">
    <div class="left">
      <div class="title">{t().title}</div>
      <button class="export" on:click={runSchematicExport}>{t().runExport}</button>
      <button class="diagnostics" on:click={refreshDiagnostics}>{t().refreshDiagnostics}</button>
    </div>
    <div class="hint">{statusMessage}</div>
  </header>

  <section class="canvas">
    <SvelteFlow {nodes} {edges} fitView on:nodeclick={onNodeClick}>
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
    background: linear-gradient(160deg, #f4f6fb 0%, #edf2f9 60%, #e8eef8 100%);
  }

  .toolbar {
    padding: 10px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #d7dbe4;
    background: rgba(255, 255, 255, 0.78);
    backdrop-filter: blur(6px);
    gap: 16px;
  }

  .title {
    font-size: 13px;
    font-weight: 700;
    color: #253046;
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
    border: 1px solid #8ea2c9;
    background: #e8eefb;
    color: #1f2a3a;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
  }

  .export:hover {
    background: #dce8ff;
  }

  .diagnostics {
    border: 1px solid #8cad8e;
    background: #eaf6ea;
    color: #1f2a3a;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
  }

  .diagnostics:hover {
    background: #dcf1dc;
  }

  .hint {
    font-size: 11px;
    color: #59657c;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .canvas {
    min-height: 0;
  }
</style>

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
    WebviewToExtensionMessage
  } from '../shared/types';

  declare function acquireVsCodeApi(): {
    postMessage: (message: WebviewToExtensionMessage) => void;
  };

  type NodeData = {
    label: string;
    sourceFile?: string;
  };

  const vscode = acquireVsCodeApi();

  const nodes = writable<Node<NodeData>[]>([]);
  const edges = writable<Edge[]>([]);

  let sourceNodes: CircuitNode[] = [];
  let sourceEdges: CircuitEdge[] = [];
  let activeFile: string | undefined;
  let statusMessage = 'Loading circuit...';

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
        return {
          id: node.id,
          position: node.position,
          data: {
            label: node.label,
            sourceFile
          },
          style: {
            border: isActive ? '2px solid #ff8c42' : '1px solid #98a3b8',
            background: isActive ? '#fff2e4' : '#ffffff',
            color: '#1f2a3a',
            borderRadius: '10px',
            boxShadow: isActive ? '0 8px 18px rgba(255, 140, 66, 0.24)' : '0 4px 10px rgba(31, 42, 58, 0.08)',
            fontWeight: isActive ? '700' : '500'
          }
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
    rebuildFlowNodes();
    rebuildFlowEdges();
    const mappedCount = sourceNodes.filter((item) => item.sourceLocation?.file).length;
    statusMessage = `Loaded ${sourceNodes.length} nodes (${mappedCount} mapped)`;
  }

  function handleMessage(event: MessageEvent<ExtensionToWebviewMessage>) {
    if (event.data.type === 'init') {
      applyInit(event.data);
      return;
    }

    if (event.data.type === 'highlight-by-file') {
      activeFile = event.data.payload.activeFile;
      rebuildFlowNodes();
    }
  }

  function onNodeClick(event: CustomEvent<{ node: Node<NodeData> }>) {
    const id = event.detail.node.id;
    const found = sourceNodes.find((item) => item.id === id);
    if (!found?.sourceLocation?.file) {
      statusMessage = `Node "${id}" has no source mapping`;
      return;
    }
    statusMessage = `Jumping to ${found.sourceLocation.file}:${found.sourceLocation.line ?? 1}`;
    vscode.postMessage({
      type: 'node-click',
      payload: { id }
    });
  }

  window.addEventListener('message', handleMessage);
  vscode.postMessage({ type: 'ready' });
</script>

<main class="shell">
  <header class="toolbar">
    <div class="title">Ranvier Circuit View</div>
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
    align-items: baseline;
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

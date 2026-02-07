import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import type {
  CircuitNode,
  NodeDiagnosticsSummary,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from './shared/types';
import type { CircuitPayload, RawSchematic } from './core/schematic';
import { normalizePath, parseCircuitPayload } from './core/schematic';
import { resolveSourceFilePath } from './core/source-resolution';
import { parseNodeDiagnostics, summarizeNodeDiagnostics } from './core/diagnostics';
import {
  extractNodeIdFromDiagnosticMessage,
  findNodeIdFromDiagnosticsAtLine,
  projectNodeProblems
} from './core/problems';

type CircuitState = {
  payload: CircuitPayload;
  diagnosticsUpdatedAt?: string;
};

type DiagnosticsState = {
  summaryByNode: Map<string, NodeDiagnosticsSummary>;
  updatedAt?: string;
};

class CircuitStore {
  private cache: CircuitState | null = null;

  async getState(): Promise<CircuitState> {
    if (this.cache) {
      return this.cache;
    }
    this.cache = await loadCircuitState();
    return this.cache;
  }

  async refresh(): Promise<CircuitState> {
    this.cache = await loadCircuitState();
    return this.cache;
  }

  async getPayload(): Promise<CircuitPayload> {
    return (await this.getState()).payload;
  }
}

class CircuitSidebarViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private payload: CircuitPayload = fallbackPayload();
  private focusedNodeId: string | undefined;
  private locale = 'en';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getSidebarWebviewHtml(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage((message: { type?: string; payload?: { nodeId?: string } }) => {
      if (!message?.type) return;
      if (message.type === 'refresh-circuit') {
        void vscode.commands.executeCommand('ranvier.refreshCircuitData');
        return;
      }
      if (message.type === 'run-export') {
        void vscode.commands.executeCommand('ranvier.exportSchematic');
        return;
      }
      if (message.type === 'refresh-diagnostics') {
        void vscode.commands.executeCommand('ranvier.refreshDiagnostics');
        return;
      }
      if (message.type === 'reveal-node' && message.payload?.nodeId) {
        void vscode.commands.executeCommand('ranvier.revealNodeSource', message.payload.nodeId);
      }
    });

    this.postInit();
  }

  update(payload: CircuitPayload, focusedNodeId: string | undefined, locale: string): void {
    this.payload = payload;
    this.focusedNodeId = focusedNodeId;
    this.locale = locale;
    this.postInit();
  }

  focusNode(nodeId: string | undefined): void {
    this.focusedNodeId = nodeId;
    if (!this.view) return;
    void this.view.webview.postMessage({
      type: 'focus-node',
      payload: { nodeId }
    });
  }

  private postInit(): void {
    if (!this.view) return;
    const nodes = this.payload.nodes.map((node) => {
      const nodeDiagnostics = (node as { diagnostics?: NodeDiagnosticsSummary }).diagnostics;
      const diag = formatDiagnosticsSummary(nodeDiagnostics);
      const diagnostics = diagnosticsTooltip(nodeDiagnostics);
      return {
        id: node.id,
        label: node.label,
        description: diag ? `${node.id} ${diag}` : node.id,
        mapped: Boolean(node.sourceLocation),
        diagnostics
      };
    });

    void this.view.webview.postMessage({
      type: 'init',
      payload: {
        locale: this.locale,
        focusedNodeId: this.focusedNodeId,
        nodes
      }
    });
  }
}

let activePanel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const store = new CircuitStore();
  const sidebarProvider = new CircuitSidebarViewProvider(context.extensionUri);
  const problemCollection = vscode.languages.createDiagnosticCollection('ranvier');
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ranvierCircuitNodes', sidebarProvider)
  );
  let editorSyncTimer: NodeJS.Timeout | undefined;
  let lastPostedActiveFile: string | undefined;
  let lastPostedFocusedNodeId: string | undefined;

  const syncEditorContextToWebview = async () => {
    const activeFile = normalizeToWorkspaceRelative(activeEditorFilePath());
    if (activeFile !== lastPostedActiveFile) {
      lastPostedActiveFile = activeFile;
      postMessage(activePanel?.webview, {
        type: 'highlight-by-file',
        payload: { activeFile }
      });
    }
    const state = await store.getState();
    const focusedNodeId = findFocusedNodeIdFromEditorContext(state.payload, problemCollection);
    if (focusedNodeId !== lastPostedFocusedNodeId) {
      lastPostedFocusedNodeId = focusedNodeId;
      sidebarProvider.focusNode(focusedNodeId);
      postMessage(activePanel?.webview, {
        type: 'highlight-node',
        payload: { nodeId: focusedNodeId }
      });
    }
  };

  const scheduleEditorContextSync = () => {
    if (editorSyncTimer) {
      clearTimeout(editorSyncTimer);
    }
    editorSyncTimer = setTimeout(() => {
      void syncEditorContextToWebview();
    }, 60);
  };
  context.subscriptions.push(problemCollection);

  void store
    .getState()
    .then((state) => {
      syncProblemsPanel(state.payload, problemCollection);
      sidebarProvider.update(
        state.payload,
        findFocusedNodeIdFromEditorContext(state.payload, problemCollection),
        vscode.env.language
      );
    })
    .catch((error) => console.error('Failed to initialize Ranvier problems panel', error));

  context.subscriptions.push(
    vscode.commands.registerCommand('ranvier.openCircuitView', async () => {
      activePanel = vscode.window.createWebviewPanel(
        'ranvierCircuitView',
        'Ranvier Circuit View',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      activePanel.webview.html = getWebviewHtml(activePanel.webview, context.extensionUri);

      activePanel.webview.onDidReceiveMessage(
        async (message: WebviewToExtensionMessage) => {
          if (message.type === 'ready') {
            await postInit(activePanel?.webview, store);
            return;
          }

          if (message.type === 'node-click') {
            await revealNodeSource(message.payload.id, store);
            return;
          }

          if (message.type === 'run-schematic-export') {
            const exportResult = await runSchematicExport(store, sidebarProvider, problemCollection);
            postMessage(activePanel?.webview, {
              type: 'export-result',
              payload: {
                ok: exportResult.ok,
                message: exportResult.message
              }
            });
            return;
          }

          if (message.type === 'refresh-diagnostics') {
            const state = await store.refresh();
            syncProblemsPanel(state.payload, problemCollection);
            sidebarProvider.update(
              state.payload,
              findFocusedNodeIdFromEditorContext(state.payload, problemCollection),
              vscode.env.language
            );
            await postInit(activePanel?.webview, store);
          }
        },
        undefined,
        context.subscriptions
      );

      activePanel.onDidDispose(() => {
        activePanel = null;
      });
    }),
    vscode.commands.registerCommand('ranvier.refreshCircuitData', async () => {
      const state = await store.refresh();
      syncProblemsPanel(state.payload, problemCollection);
      sidebarProvider.update(
        state.payload,
        findFocusedNodeIdFromEditorContext(state.payload, problemCollection),
        vscode.env.language
      );
      await postInit(activePanel?.webview, store);
      vscode.window.showInformationMessage('Ranvier circuit data refreshed.');
    }),
    vscode.commands.registerCommand('ranvier.refreshDiagnostics', async () => {
      const state = await store.refresh();
      syncProblemsPanel(state.payload, problemCollection);
      sidebarProvider.update(
        state.payload,
        findFocusedNodeIdFromEditorContext(state.payload, problemCollection),
        vscode.env.language
      );
      await postInit(activePanel?.webview, store);
      vscode.window.showInformationMessage('Ranvier diagnostics refreshed.');
    }),
    vscode.commands.registerCommand('ranvier.exportSchematic', async () => {
      await runSchematicExport(store, sidebarProvider, problemCollection);
    }),
    vscode.commands.registerCommand('ranvier.revealNodeSource', async (nodeId: string) => {
      await revealNodeSource(nodeId, store);
    }),
    vscode.commands.registerCommand('ranvier.revealNodeFromCurrentLine', async () => {
      const state = await store.getState();
      const focusedNodeId = findFocusedNodeIdFromEditorContext(state.payload, problemCollection);
      if (!focusedNodeId) {
        vscode.window.showInformationMessage(
          'Ranvier: no mapped circuit node found for current editor line.'
        );
        return;
      }
      await focusNodeInUi(focusedNodeId, sidebarProvider, activePanel?.webview);
      vscode.window.showInformationMessage(`Ranvier: focused node "${focusedNodeId}".`);
    }),
    vscode.commands.registerCommand('ranvier.nextNodeIssue', async () => {
      await revealRanvierNodeIssue(1, sidebarProvider, problemCollection);
    }),
    vscode.commands.registerCommand('ranvier.previousNodeIssue', async () => {
      await revealRanvierNodeIssue(-1, sidebarProvider, problemCollection);
    }),
    vscode.window.onDidChangeActiveTextEditor(async () => {
      scheduleEditorContextSync();
    }),
    vscode.window.onDidChangeTextEditorSelection(async () => {
      scheduleEditorContextSync();
    })
  );
}

export function deactivate(): void {
  activePanel = null;
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.js')
  );
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.css')
  );
  const nonce = String(Date.now());
  const htmlLang = vscode.env.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';

  return `<!doctype html>
<html lang="${htmlLang}">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${cssUri}" />
    <title>Ranvier Circuit View</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${jsUri}"></script>
  </body>
</html>`;
}

function getSidebarWebviewHtml(webview: vscode.Webview, _extensionUri: vscode.Uri): string {
  const nonce = String(Date.now());
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        margin: 0;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
      }
      .wrap {
        display: grid;
        gap: 12px;
        padding: 10px;
      }
      .section {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        overflow: hidden;
        background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, var(--vscode-editor-background));
      }
      .title {
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        padding: 8px 10px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        padding: 10px;
      }
      button.action {
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 6px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        padding: 7px 10px;
        text-align: left;
        cursor: pointer;
        font-size: 12px;
      }
      button.action:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .nodes {
        display: grid;
        gap: 4px;
        max-height: 320px;
        overflow: auto;
        padding: 8px;
      }
      button.node {
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
        padding: 7px 8px;
      }
      button.node:hover {
        background: var(--vscode-list-hoverBackground);
      }
      button.node.active {
        border-color: var(--vscode-focusBorder);
        background: var(--vscode-list-activeSelectionBackground);
      }
      button.node:disabled {
        opacity: 0.55;
        cursor: default;
      }
      .node-title {
        font-size: 13px;
      }
      .node-desc {
        margin-top: 2px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .empty {
        padding: 10px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="section">
        <div id="actions-title" class="title">Quick Actions</div>
        <div class="actions">
          <button id="refresh-circuit" class="action" type="button">Refresh Circuit Data</button>
          <button id="run-export" class="action" type="button">Run Schematic Export</button>
          <button id="refresh-diagnostics" class="action" type="button">Refresh Diagnostics</button>
        </div>
      </section>
      <section class="section">
        <div id="nodes-title" class="title">Circuit Nodes</div>
        <div id="nodes" class="nodes"></div>
      </section>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const nodesRoot = document.getElementById('nodes');
      const actionsTitle = document.getElementById('actions-title');
      const nodesTitle = document.getElementById('nodes-title');
      const labelsByLocale = {
        ko: {
          actions: '빠른 작업',
          nodes: '회로 노드',
          refreshCircuit: '회로 데이터 새로고침',
          runExport: 'Schematic Export 실행',
          refreshDiagnostics: '진단 새로고침',
          noNodes: '표시할 노드가 없습니다.',
          noSource: '소스 매핑 없음'
        },
        en: {
          actions: 'Quick Actions',
          nodes: 'Circuit Nodes',
          refreshCircuit: 'Refresh Circuit Data',
          runExport: 'Run Schematic Export',
          refreshDiagnostics: 'Refresh Diagnostics',
          noNodes: 'No nodes to display.',
          noSource: 'No source mapping'
        }
      };
      let current = { locale: 'en', focusedNodeId: undefined, nodes: [] };

      function t() {
        return current.locale.startsWith('ko') ? labelsByLocale.ko : labelsByLocale.en;
      }

      function render() {
        const labels = t();
        actionsTitle.textContent = labels.actions;
        nodesTitle.textContent = labels.nodes;
        document.getElementById('refresh-circuit').textContent = labels.refreshCircuit;
        document.getElementById('run-export').textContent = labels.runExport;
        document.getElementById('refresh-diagnostics').textContent = labels.refreshDiagnostics;

        nodesRoot.innerHTML = '';
        if (!current.nodes.length) {
          const empty = document.createElement('div');
          empty.className = 'empty';
          empty.textContent = labels.noNodes;
          nodesRoot.appendChild(empty);
          return;
        }

        for (const node of current.nodes) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'node';
          if (current.focusedNodeId && current.focusedNodeId === node.id) {
            btn.classList.add('active');
          }
          btn.disabled = !node.mapped;
          btn.title = node.mapped ? (node.diagnostics || node.description || node.id) : labels.noSource;
          btn.addEventListener('click', () => {
            if (!node.mapped) return;
            vscode.postMessage({ type: 'reveal-node', payload: { nodeId: node.id } });
          });

          const title = document.createElement('div');
          title.className = 'node-title';
          title.textContent = node.label;
          btn.appendChild(title);

          const desc = document.createElement('div');
          desc.className = 'node-desc';
          desc.textContent = node.description || node.id;
          btn.appendChild(desc);

          nodesRoot.appendChild(btn);
        }
      }

      document.getElementById('refresh-circuit').addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh-circuit' });
      });
      document.getElementById('run-export').addEventListener('click', () => {
        vscode.postMessage({ type: 'run-export' });
      });
      document.getElementById('refresh-diagnostics').addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh-diagnostics' });
      });

      window.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.type === 'init') {
          current = message.payload || current;
          render();
          return;
        }
        if (message.type === 'focus-node') {
          current = { ...current, focusedNodeId: message.payload?.nodeId };
          render();
        }
      });
    </script>
  </body>
</html>`;
}

async function revealNodeSource(nodeId: string, store: CircuitStore): Promise<void> {
  const payload = await store.getPayload();
  const node = payload.nodes.find((item) => item.id === nodeId);
  if (!node?.sourceLocation) {
    vscode.window.showWarningMessage(`Node "${nodeId}" has no source mapping.`);
    return;
  }
  await openSource(node.sourceLocation.file, node.sourceLocation.line);
}

async function loadCircuitState(): Promise<CircuitState> {
  const workspaceFolder = resolveActiveWorkspaceRoot();
  const diagnostics = await loadDiagnosticsState(workspaceFolder);

  let payload: CircuitPayload | null = null;
  if (workspaceFolder) {
    const schematicPath = path.join(workspaceFolder, 'schematic.json');
    if (fs.existsSync(schematicPath)) {
      try {
        const raw = await fs.promises.readFile(schematicPath, 'utf8');
        const parsed = JSON.parse(raw) as RawSchematic;
        const parsedPayload = parseCircuitPayload(parsed);
        if (parsedPayload.nodes.length > 0) {
          payload = parsedPayload;
        }
      } catch (error) {
        console.error('Failed to parse schematic.json', error);
      }
    }
  }

  const mergedPayload = withDiagnostics(payload ?? fallbackPayload(), diagnostics.summaryByNode);
  return {
    payload: mergedPayload,
    diagnosticsUpdatedAt: diagnostics.updatedAt
  };
}

function fallbackPayload(): CircuitPayload {
  return {
    nodes: [
      {
        id: 'ingress',
        label: 'Ingress',
        position: { x: 60, y: 160 },
        sourceLocation: { file: 'ranvier/examples/studio-demo/src/main.rs', line: 1 }
      },
      {
        id: 'inspect',
        label: 'Inspect',
        position: { x: 320, y: 160 },
        sourceLocation: { file: 'ranvier/extensions/inspector/src/lib.rs', line: 1 }
      },
      {
        id: 'egress',
        label: 'Egress',
        position: { x: 580, y: 160 }
      }
    ],
    edges: [
      { id: 'e1', source: 'ingress', target: 'inspect', label: 'flow' },
      { id: 'e2', source: 'inspect', target: 'egress', label: 'emit' }
    ]
  };
}

async function loadDiagnosticsState(workspaceFolder: string | undefined): Promise<DiagnosticsState> {
  if (!workspaceFolder) {
    return { summaryByNode: new Map<string, NodeDiagnosticsSummary>() };
  }

  const diagnosticsPath = resolveDiagnosticsPath(workspaceFolder);
  if (!fs.existsSync(diagnosticsPath)) {
    return { summaryByNode: new Map<string, NodeDiagnosticsSummary>() };
  }

  try {
    const raw = await fs.promises.readFile(diagnosticsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const items = parseNodeDiagnostics(parsed);
    const stats = await fs.promises.stat(diagnosticsPath);
    return {
      summaryByNode: summarizeNodeDiagnostics(items),
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    console.error('Failed to parse diagnostics.json', error);
    return { summaryByNode: new Map<string, NodeDiagnosticsSummary>() };
  }
}

function resolveDiagnosticsPath(workspaceFolder: string): string {
  const config = vscode.workspace.getConfiguration('ranvier');
  const configuredPath = config.get<string>('diagnostics.inputPath', 'diagnostics.json');
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(workspaceFolder, configuredPath);
}

function withDiagnostics(
  payload: CircuitPayload,
  diagnosticsByNode: Map<string, NodeDiagnosticsSummary>
): CircuitPayload {
  return {
    ...payload,
    nodes: payload.nodes.map((node) => ({
      ...node,
      diagnostics: diagnosticsByNode.get(node.id)
    }))
  };
}

function activeEditorFilePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath;
}

function normalizeToWorkspaceRelative(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const workspaceFolder = resolveActiveWorkspaceRoot({ preferFilePath: filePath });
  if (!workspaceFolder) {
    return normalizePath(filePath);
  }
  const normalizedPath = normalizePath(filePath);
  const normalizedWorkspace = normalizePath(workspaceFolder);
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath;
}

function postMessage(
  webview: vscode.Webview | null | undefined,
  message: ExtensionToWebviewMessage
): void {
  if (!webview) {
    return;
  }
  void webview.postMessage(message);
}

async function postInit(
  webview: vscode.Webview | null | undefined,
  store: CircuitStore
): Promise<void> {
  const state = await store.getState();
  postMessage(webview, {
    type: 'init',
    payload: {
      ...state.payload,
      activeFile: normalizeToWorkspaceRelative(activeEditorFilePath()),
      diagnosticsUpdatedAt: state.diagnosticsUpdatedAt,
      locale: vscode.env.language,
      focusedNodeId: findFocusedNodeIdFromEditorContext(state.payload)
    }
  });
}

function findFocusedNodeIdFromEditorContext(
  payload: CircuitPayload,
  problemCollection?: vscode.DiagnosticCollection
): string | undefined {
  return findFocusedNodeIdFromProblems(problemCollection) ?? findFocusedNodeIdFromActiveEditor(payload);
}

function findFocusedNodeIdFromProblems(
  problemCollection: vscode.DiagnosticCollection | undefined
): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !problemCollection) {
    return undefined;
  }
  const diagnostics = problemCollection.get(editor.document.uri) ?? [];
  return findNodeIdFromDiagnosticsAtLine(
    diagnostics,
    editor.selection.active.line,
    editor.selection.active.character
  );
}

function formatDiagnosticsSummary(diagnostics: NodeDiagnosticsSummary | undefined): string | undefined {
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
  return chunks.length > 0 ? `[${chunks.join(' ')}]` : undefined;
}

function diagnosticsTooltip(diagnostics: NodeDiagnosticsSummary | undefined): string | undefined {
  if (!diagnostics || diagnostics.items.length === 0) {
    return undefined;
  }
  const preview = diagnostics.items
    .slice(0, 3)
    .map((item) => `${item.severity.toUpperCase()}: ${item.message} (${item.source})`)
    .join('\n');
  const hidden = diagnostics.items.length - 3;
  return hidden > 0 ? `${preview}\n... +${hidden} more` : preview;
}

function findFocusedNodeIdFromActiveEditor(payload: CircuitPayload): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const activeFile = normalizeToWorkspaceRelative(editor.document.uri.fsPath);
  if (!activeFile) {
    return undefined;
  }
  const line = editor.selection.active.line + 1;

  let exact: CircuitNode | undefined;
  let nearest: CircuitNode | undefined;
  let nearestLine = -1;
  for (const node of payload.nodes) {
    if (!node.sourceLocation?.file || normalizePath(node.sourceLocation.file) !== normalizePath(activeFile)) {
      continue;
    }
    const nodeLine = node.sourceLocation.line ?? 1;
    if (nodeLine === line) {
      exact = node;
      break;
    }
    if (nodeLine <= line && nodeLine > nearestLine) {
      nearest = node;
      nearestLine = nodeLine;
    }
  }

  return exact?.id ?? nearest?.id;
}

async function focusNodeInUi(
  nodeId: string,
  sidebarProvider: CircuitSidebarViewProvider,
  webview: vscode.Webview | null | undefined
): Promise<void> {
  sidebarProvider.focusNode(nodeId);
  postMessage(webview, {
    type: 'highlight-node',
    payload: { nodeId }
  });
}

async function openSource(relativePath: string, line = 1): Promise<void> {
  for (const workspaceFolder of candidateWorkspaceRoots()) {
    const resolved = resolveSourceFilePath(workspaceFolder, relativePath, line);
    if (!resolved.ok) {
      continue;
    }

    const document = await vscode.workspace.openTextDocument(resolved.filePath);
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    const targetLine = Math.max(0, resolved.line - 1);
    const targetPos = new vscode.Position(targetLine, 0);
    editor.selection = new vscode.Selection(targetPos, targetPos);
    editor.revealRange(new vscode.Range(targetPos, targetPos), vscode.TextEditorRevealType.InCenter);
    return;
  }

  const fallback = resolveSourceFilePath(undefined, relativePath, line);
  const message = fallback.ok
    ? `Unable to open source path: ${relativePath}`
    : fallback.message;
  vscode.window.showWarningMessage(message);
}

async function runSchematicExport(
  store: CircuitStore,
  sidebarProvider: CircuitSidebarViewProvider,
  problemCollection: vscode.DiagnosticCollection
): Promise<{ ok: boolean; message: string }> {
  const workspaceFolder = resolveActiveWorkspaceRoot();
  if (!workspaceFolder) {
    const message = 'Ranvier schematic export failed: open a workspace folder first.';
    vscode.window.showWarningMessage(message);
    return { ok: false, message };
  }

  const config = vscode.workspace.getConfiguration('ranvier');
  const example = config.get<string>('schematicExport.example', 'basic-schematic');
  const outputPath = config.get<string>('schematicExport.outputPath', 'schematic.json');
  const cliManifestPath = config.get<string>('schematicExport.cliManifestPath', 'cli/Cargo.toml');
  const manifestCandidate = path.isAbsolute(cliManifestPath)
    ? cliManifestPath
    : path.join(workspaceFolder, cliManifestPath);
  const canUseCargoManifest = fs.existsSync(manifestCandidate);

  const runCommand = (
    command: string,
    args: string[]
  ): Promise<{ ok: boolean; stderrTail?: string; spawnError?: string }> =>
    new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: workspaceFolder,
        shell: process.platform === 'win32'
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true });
          return;
        }
        const stderrTail = stderr.trim().split(/\r?\n/).slice(-1)[0] ?? `${command} exited ${code}`;
        resolve({ ok: false, stderrTail });
      });
      child.on('error', (error) => {
        resolve({ ok: false, spawnError: error.message });
      });
    });

  const run = async (): Promise<{ ok: boolean; message: string }> => {
    const cargoArgs = [
      'run',
      '--manifest-path',
      cliManifestPath,
      '--',
      'schematic',
      example,
      '--output',
      outputPath
    ];
    const ranvierArgs = ['schematic', example, '--output', outputPath];

    let cargoFailure: string | undefined;
    if (canUseCargoManifest) {
      const cargoResult = await runCommand('cargo', cargoArgs);
      if (cargoResult.ok) {
        const state = await store.refresh();
        syncProblemsPanel(state.payload, problemCollection);
        sidebarProvider.update(
          state.payload,
          findFocusedNodeIdFromEditorContext(state.payload, problemCollection),
          vscode.env.language
        );
        await postInit(activePanel?.webview, store);
        const message = `Ranvier schematic exported: ${outputPath}`;
        vscode.window.showInformationMessage(message);
        return { ok: true, message };
      }
      cargoFailure = cargoResult.spawnError ?? cargoResult.stderrTail;
    }

    const ranvierResult = await runCommand('ranvier', ranvierArgs);
    if (ranvierResult.ok) {
      const state = await store.refresh();
      syncProblemsPanel(state.payload, problemCollection);
      sidebarProvider.update(
        state.payload,
        findFocusedNodeIdFromEditorContext(state.payload, problemCollection),
        vscode.env.language
      );
      await postInit(activePanel?.webview, store);
      const mode = canUseCargoManifest ? 'ranvier CLI fallback' : 'ranvier CLI';
      const message = `Ranvier schematic exported: ${outputPath} (${mode})`;
      vscode.window.showInformationMessage(message);
      return { ok: true, message };
    }

    const ranvierFailure = ranvierResult.spawnError ?? ranvierResult.stderrTail ?? 'unknown error';
    const hint = canUseCargoManifest
      ? `cargo error: ${cargoFailure ?? 'unknown'}; ranvier error: ${ranvierFailure}`
      : `manifest not found (${cliManifestPath}); ranvier error: ${ranvierFailure}`;
    const message =
      `Ranvier schematic export failed: ${hint}. ` +
      `Set ranvier.schematicExport.cliManifestPath to a valid manifest or install ranvier-cli.`;
    vscode.window.showErrorMessage(message);
    return { ok: false, message };
  };

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Ranvier: Running schematic export...',
      cancellable: false
    },
    async () => run()
  );
}

function syncProblemsPanel(
  payload: CircuitPayload,
  problemCollection: vscode.DiagnosticCollection
): void {
  problemCollection.clear();

  const workspaceFolders = candidateWorkspaceRoots();
  if (workspaceFolders.length === 0) {
    return;
  }

  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const problem of projectNodeProblems(payload.nodes)) {
    let resolvedPath: { filePath: string; line: number } | undefined;
    for (const workspaceFolder of workspaceFolders) {
      const resolved = resolveSourceFilePath(workspaceFolder, problem.relativeFilePath, problem.line);
      if (!resolved.ok) continue;
      resolvedPath = { filePath: resolved.filePath, line: resolved.line };
      break;
    }
    if (!resolvedPath) {
      continue;
    }
    const line = Math.max(0, resolvedPath.line - 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, 200),
      `[${problem.nodeLabel}#${problem.nodeId}] ${problem.message}`,
      toVscodeSeverity(problem.severity)
    );
    diagnostic.source = `ranvier:${problem.source}`;

    const entries = byFile.get(resolvedPath.filePath) ?? [];
    entries.push(diagnostic);
    byFile.set(resolvedPath.filePath, entries);
  }

  for (const [filePath, diagnostics] of byFile.entries()) {
    problemCollection.set(vscode.Uri.file(filePath), diagnostics);
  }
}

type WorkspaceRootResolveOptions = {
  preferFilePath?: string;
};

function resolveActiveWorkspaceRoot(options: WorkspaceRootResolveOptions = {}): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return undefined;

  const fromPreferredPath = resolveWorkspaceRootFromFilePath(options.preferFilePath);
  if (fromPreferredPath) return fromPreferredPath;

  const fromActiveEditor = resolveWorkspaceRootFromFilePath(activeEditorFilePath());
  if (fromActiveEditor) return fromActiveEditor;

  let best: { root: string; score: number } | undefined;
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    const score = scoreWorkspaceRoot(root);
    if (!best || score > best.score) {
      best = { root, score };
    }
  }
  if (best && best.score > 0) return best.root;
  return folders[0]?.uri.fsPath;
}

function candidateWorkspaceRoots(): string[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return [];

  const roots = new Set<string>();
  const preferred = resolveActiveWorkspaceRoot();
  if (preferred) roots.add(preferred);
  for (const folder of folders) {
    roots.add(folder.uri.fsPath);
  }
  return [...roots];
}

function resolveWorkspaceRootFromFilePath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return folder?.uri.fsPath;
}

function scoreWorkspaceRoot(root: string): number {
  let score = 0;
  if (fs.existsSync(path.join(root, 'schematic.json'))) score += 3;
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) score += 2;
  if (fs.existsSync(path.join(root, 'package.json'))) score += 1;
  return score;
}

function toVscodeSeverity(severity: 'error' | 'warning' | 'info'): vscode.DiagnosticSeverity {
  if (severity === 'error') {
    return vscode.DiagnosticSeverity.Error;
  }
  if (severity === 'warning') {
    return vscode.DiagnosticSeverity.Warning;
  }
  return vscode.DiagnosticSeverity.Information;
}

type NodeIssueLocation = {
  uri: vscode.Uri;
  line: number;
  character: number;
  nodeId?: string;
};

async function revealRanvierNodeIssue(
  direction: 1 | -1,
  sidebarProvider: CircuitSidebarViewProvider,
  problemCollection: vscode.DiagnosticCollection
): Promise<void> {
  const issues = collectRanvierNodeIssues(problemCollection);
  if (issues.length === 0) {
    vscode.window.showInformationMessage('Ranvier: no node issues found in Problems.');
    return;
  }

  const current = currentEditorCursorKey();
  const currentIndex =
    current === undefined
      ? -1
      : issues.findIndex((issue) => compareIssuePosition(issue, current) >= 0);

  let targetIndex = 0;
  if (direction > 0) {
    targetIndex = currentIndex >= 0 ? currentIndex : 0;
  } else {
    targetIndex = currentIndex > 0 ? currentIndex - 1 : issues.length - 1;
  }

  const target = issues[targetIndex];
  if (!target) {
    return;
  }

  const document = await vscode.workspace.openTextDocument(target.uri);
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  const pos = new vscode.Position(target.line, target.character);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

  if (target.nodeId) {
    await focusNodeInUi(target.nodeId, sidebarProvider, activePanel?.webview);
  }
}

function collectRanvierNodeIssues(problemCollection: vscode.DiagnosticCollection): NodeIssueLocation[] {
  const issues: NodeIssueLocation[] = [];
  problemCollection.forEach((uri, diagnostics) => {
    for (const diagnostic of diagnostics) {
      const nodeId = extractNodeIdFromDiagnosticMessage(diagnostic.message);
      if (!nodeId) {
        continue;
      }
      issues.push({
        uri,
        line: diagnostic.range.start.line,
        character: diagnostic.range.start.character,
        nodeId
      });
    }
  });

  issues.sort((a, b) => compareIssuePosition(a, b));
  return issues;
}

type CursorKey = {
  uriPath: string;
  line: number;
  character: number;
};

function currentEditorCursorKey(): CursorKey | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  return {
    uriPath: normalizePath(editor.document.uri.fsPath),
    line: editor.selection.active.line,
    character: editor.selection.active.character
  };
}

function compareIssuePosition(
  left: NodeIssueLocation,
  right: NodeIssueLocation | CursorKey
): number {
  const leftPath = normalizePath(left.uri.fsPath);
  const rightPath =
    'uriPath' in right ? right.uriPath : normalizePath((right as NodeIssueLocation).uri.fsPath);
  const pathCompare = leftPath.localeCompare(rightPath);
  if (pathCompare !== 0) {
    return pathCompare;
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.character - right.character;
}

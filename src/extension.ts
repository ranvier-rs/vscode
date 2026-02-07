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

class CircuitNodeTreeItem extends vscode.TreeItem {
  constructor(node: CircuitNode) {
    super(node.label, vscode.TreeItemCollapsibleState.None);
    this.id = node.id;
    const diagSummary = formatDiagnosticsSummary(node.diagnostics);
    this.description = diagSummary ? `${node.id} ${diagSummary}` : node.id;
    this.contextValue = node.sourceLocation ? 'mappedNode' : 'unmappedNode';
    const sourceLine = node.sourceLocation
      ? `${node.sourceLocation.file}:${node.sourceLocation.line ?? 1}`
      : '(No source mapping)';
    const diagnosticsLine = diagnosticsTooltip(node.diagnostics);
    this.tooltip = diagnosticsLine
      ? `${node.label}\n${sourceLine}\n${diagnosticsLine}`
      : `${node.label}\n${sourceLine}`;
    this.iconPath = diagnosticsIcon(node.diagnostics);
    if (node.sourceLocation) {
      this.command = {
        command: 'ranvier.revealNodeSource',
        title: 'Reveal Source',
        arguments: [node.id]
      };
    }
  }
}

class CircuitTreeProvider implements vscode.TreeDataProvider<CircuitNodeTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private latestItemsById = new Map<string, CircuitNodeTreeItem>();

  constructor(private readonly store: CircuitStore) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  async getChildren(): Promise<CircuitNodeTreeItem[]> {
    const payload = await this.store.getPayload();
    const items = payload.nodes.map((node) => new CircuitNodeTreeItem(node));
    this.latestItemsById = new Map(items.map((item) => [String(item.id), item]));
    return items;
  }

  getTreeItem(element: CircuitNodeTreeItem): vscode.TreeItem {
    return element;
  }

  getItemById(nodeId: string): CircuitNodeTreeItem | undefined {
    return this.latestItemsById.get(nodeId);
  }
}

let activePanel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const store = new CircuitStore();
  const treeProvider = new CircuitTreeProvider(store);
  const problemCollection = vscode.languages.createDiagnosticCollection('ranvier');
  const treeView = vscode.window.createTreeView('ranvierCircuitNodes', {
    treeDataProvider: treeProvider
  });
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
  context.subscriptions.push(treeView);
  context.subscriptions.push(problemCollection);

  void store
    .getState()
    .then((state) => syncProblemsPanel(state.payload, problemCollection))
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
            const exportResult = await runSchematicExport(store, treeProvider, problemCollection);
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
            treeProvider.refresh();
            syncProblemsPanel(state.payload, problemCollection);
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
      treeProvider.refresh();
      syncProblemsPanel(state.payload, problemCollection);
      await postInit(activePanel?.webview, store);
      vscode.window.showInformationMessage('Ranvier circuit data refreshed.');
    }),
    vscode.commands.registerCommand('ranvier.refreshDiagnostics', async () => {
      const state = await store.refresh();
      treeProvider.refresh();
      syncProblemsPanel(state.payload, problemCollection);
      await postInit(activePanel?.webview, store);
      vscode.window.showInformationMessage('Ranvier diagnostics refreshed.');
    }),
    vscode.commands.registerCommand('ranvier.exportSchematic', async () => {
      await runSchematicExport(store, treeProvider, problemCollection);
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
      await focusNodeInUi(focusedNodeId, treeProvider, treeView, activePanel?.webview);
      vscode.window.showInformationMessage(`Ranvier: focused node "${focusedNodeId}".`);
    }),
    vscode.commands.registerCommand('ranvier.nextNodeIssue', async () => {
      await revealRanvierNodeIssue(1, treeProvider, treeView, problemCollection);
    }),
    vscode.commands.registerCommand('ranvier.previousNodeIssue', async () => {
      await revealRanvierNodeIssue(-1, treeProvider, treeView, problemCollection);
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
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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

function diagnosticsIcon(
  diagnostics: NodeDiagnosticsSummary | undefined
): vscode.ThemeIcon | undefined {
  if (!diagnostics) {
    return undefined;
  }
  if (diagnostics.error > 0) {
    return new vscode.ThemeIcon('error');
  }
  if (diagnostics.warning > 0) {
    return new vscode.ThemeIcon('warning');
  }
  if (diagnostics.info > 0) {
    return new vscode.ThemeIcon('info');
  }
  return undefined;
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
  treeProvider: CircuitTreeProvider,
  treeView: vscode.TreeView<CircuitNodeTreeItem>,
  webview: vscode.Webview | null | undefined
): Promise<void> {
  postMessage(webview, {
    type: 'highlight-node',
    payload: { nodeId }
  });
  const item = treeProvider.getItemById(nodeId);
  if (item) {
    await treeView.reveal(item, {
      select: true,
      focus: false
    });
  }
}

async function openSource(relativePath: string, line = 1): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const resolved = resolveSourceFilePath(workspaceFolder, relativePath, line);
  if (!resolved.ok) {
    vscode.window.showWarningMessage(resolved.message);
    return;
  }

  const document = await vscode.workspace.openTextDocument(resolved.filePath);
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  const targetLine = Math.max(0, resolved.line - 1);
  const targetPos = new vscode.Position(targetLine, 0);
  editor.selection = new vscode.Selection(targetPos, targetPos);
  editor.revealRange(new vscode.Range(targetPos, targetPos), vscode.TextEditorRevealType.InCenter);
}

async function runSchematicExport(
  store: CircuitStore,
  treeProvider: CircuitTreeProvider,
  problemCollection: vscode.DiagnosticCollection
): Promise<{ ok: boolean; message: string }> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    const message = 'Ranvier schematic export failed: open a workspace folder first.';
    vscode.window.showWarningMessage(message);
    return { ok: false, message };
  }

  const config = vscode.workspace.getConfiguration('ranvier');
  const example = config.get<string>('schematicExport.example', 'basic-schematic');
  const outputPath = config.get<string>('schematicExport.outputPath', 'schematic.json');
  const cliManifestPath = config.get<string>('schematicExport.cliManifestPath', 'cli/Cargo.toml');

  const args = [
    'run',
    '--manifest-path',
    cliManifestPath,
    '--',
    'schematic',
    example,
    '--output',
    outputPath
  ];

  const run = (): Promise<{ ok: boolean; message: string }> =>
    new Promise((resolve) => {
      const child = spawn('cargo', args, {
        cwd: workspaceFolder,
        shell: process.platform === 'win32'
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', async (code) => {
        if (code === 0) {
          const state = await store.refresh();
          treeProvider.refresh();
          syncProblemsPanel(state.payload, problemCollection);
          await postInit(activePanel?.webview, store);
          const message = `Ranvier schematic exported: ${outputPath}`;
          vscode.window.showInformationMessage(message);
          resolve({ ok: true, message });
          return;
        }
        const errorTail = stderr.trim().split(/\r?\n/).slice(-1)[0] ?? 'unknown cargo error';
        const message = `Ranvier schematic export failed: ${errorTail}`;
        vscode.window.showErrorMessage(message);
        resolve({ ok: false, message });
      });
      child.on('error', (error) => {
        const message = `Ranvier schematic export failed: ${error.message}`;
        vscode.window.showErrorMessage(message);
        resolve({ ok: false, message });
      });
    });

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

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    return;
  }

  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const problem of projectNodeProblems(payload.nodes)) {
    const resolved = resolveSourceFilePath(workspaceFolder, problem.relativeFilePath, problem.line);
    if (!resolved.ok) {
      continue;
    }
    const line = Math.max(0, problem.line - 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, 200),
      `[${problem.nodeLabel}#${problem.nodeId}] ${problem.message}`,
      toVscodeSeverity(problem.severity)
    );
    diagnostic.source = `ranvier:${problem.source}`;

    const entries = byFile.get(resolved.filePath) ?? [];
    entries.push(diagnostic);
    byFile.set(resolved.filePath, entries);
  }

  for (const [filePath, diagnostics] of byFile.entries()) {
    problemCollection.set(vscode.Uri.file(filePath), diagnostics);
  }
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
  treeProvider: CircuitTreeProvider,
  treeView: vscode.TreeView<CircuitNodeTreeItem>,
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
    await focusNodeInUi(target.nodeId, treeProvider, treeView, activePanel?.webview);
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

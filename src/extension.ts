import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import type {
  CircuitNode,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from './shared/types';
import type { CircuitPayload, RawSchematic } from './core/schematic';
import { normalizePath, parseCircuitPayload } from './core/schematic';
import { resolveSourceFilePath } from './core/source-resolution';

class CircuitStore {
  private cache: CircuitPayload | null = null;

  async getPayload(): Promise<CircuitPayload> {
    if (this.cache) {
      return this.cache;
    }
    this.cache = await loadCircuitPayload();
    return this.cache;
  }

  async refresh(): Promise<CircuitPayload> {
    this.cache = await loadCircuitPayload();
    return this.cache;
  }
}

class CircuitNodeTreeItem extends vscode.TreeItem {
  constructor(node: CircuitNode) {
    super(node.label, vscode.TreeItemCollapsibleState.None);
    this.id = node.id;
    this.description = node.id;
    this.contextValue = node.sourceLocation ? 'mappedNode' : 'unmappedNode';
    this.tooltip = node.sourceLocation
      ? `${node.label}\n${node.sourceLocation.file}:${node.sourceLocation.line ?? 1}`
      : `${node.label}\n(No source mapping)`;
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

  constructor(private readonly store: CircuitStore) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  async getChildren(): Promise<CircuitNodeTreeItem[]> {
    const payload = await this.store.getPayload();
    return payload.nodes.map((node) => new CircuitNodeTreeItem(node));
  }

  getTreeItem(element: CircuitNodeTreeItem): vscode.TreeItem {
    return element;
  }
}

let activePanel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const store = new CircuitStore();
  const treeProvider = new CircuitTreeProvider(store);

  vscode.window.registerTreeDataProvider('ranvierCircuitNodes', treeProvider);

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
            const payload = await store.getPayload();
            postMessage(activePanel?.webview, {
              type: 'init',
              payload: {
                ...payload,
                activeFile: normalizeToWorkspaceRelative(activeEditorFilePath())
              }
            });
            return;
          }

          if (message.type === 'node-click') {
            await revealNodeSource(message.payload.id, store);
            return;
          }

          if (message.type === 'run-schematic-export') {
            const exportResult = await runSchematicExport(store, treeProvider);
            postMessage(activePanel?.webview, {
              type: 'export-result',
              payload: {
                ok: exportResult.ok,
                message: exportResult.message
              }
            });
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
      await store.refresh();
      treeProvider.refresh();
      postMessage(activePanel?.webview, {
        type: 'init',
        payload: {
          ...(await store.getPayload()),
          activeFile: normalizeToWorkspaceRelative(activeEditorFilePath())
        }
      });
      vscode.window.showInformationMessage('Ranvier circuit data refreshed.');
    }),
    vscode.commands.registerCommand('ranvier.exportSchematic', async () => {
      await runSchematicExport(store, treeProvider);
    }),
    vscode.commands.registerCommand('ranvier.revealNodeSource', async (nodeId: string) => {
      await revealNodeSource(nodeId, store);
    }),
    vscode.window.onDidChangeActiveTextEditor(async () => {
      const activeFile = normalizeToWorkspaceRelative(activeEditorFilePath());
      postMessage(activePanel?.webview, {
        type: 'highlight-by-file',
        payload: { activeFile }
      });
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

  return `<!doctype html>
<html lang="en">
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

async function loadCircuitPayload(): Promise<CircuitPayload> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceFolder) {
    const schematicPath = path.join(workspaceFolder, 'schematic.json');
    if (fs.existsSync(schematicPath)) {
      try {
        const raw = await fs.promises.readFile(schematicPath, 'utf8');
        const parsed = JSON.parse(raw) as RawSchematic;
        const payload = parseCircuitPayload(parsed);
        if (payload.nodes.length > 0) {
          return payload;
        }
      } catch (error) {
        console.error('Failed to parse schematic.json', error);
      }
    }
  }

  return fallbackPayload();
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
  treeProvider: CircuitTreeProvider
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
          await store.refresh();
          treeProvider.refresh();
          postMessage(activePanel?.webview, {
            type: 'init',
            payload: {
              ...(await store.getPayload()),
              activeFile: normalizeToWorkspaceRelative(activeEditorFilePath())
            }
          });
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

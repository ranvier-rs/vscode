import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  CircuitEdge,
  CircuitNode,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from './shared/types';

type CircuitPayload = {
  nodes: CircuitNode[];
  edges: CircuitEdge[];
};

type RawNode = {
  id?: string;
  label?: string;
  metadata?: {
    label?: string;
    source_location?: { file?: string; line?: number };
    sourceLocation?: { file?: string; line?: number };
  };
  source_location?: { file?: string; line?: number };
  sourceLocation?: { file?: string; line?: number };
  position?: { x?: number; y?: number };
};

type RawEdge = {
  id?: string;
  source?: string;
  target?: string;
  from?: string;
  to?: string;
  label?: string;
};

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
        const parsed = JSON.parse(raw) as { nodes?: RawNode[]; edges?: RawEdge[] };
        const nodes: CircuitNode[] = (parsed.nodes ?? []).map((node, index) => {
          const sourceLocation =
            normalizeSourceLocation(node.source_location) ??
            normalizeSourceLocation(node.sourceLocation) ??
            normalizeSourceLocation(node.metadata?.source_location) ??
            normalizeSourceLocation(node.metadata?.sourceLocation);

          return {
            id: node.id ?? `node-${index}`,
            label: node.label ?? node.metadata?.label ?? node.id ?? `Node ${index + 1}`,
            position: {
              x: node.position?.x ?? 100 + index * 200,
              y: node.position?.y ?? (index % 2 === 0 ? 120 : 300)
            },
            sourceLocation
          };
        });

        const edges: CircuitEdge[] = (parsed.edges ?? [])
          .map((edge, index) => ({
            id: edge.id ?? `edge-${index}`,
            source: edge.source ?? edge.from ?? '',
            target: edge.target ?? edge.to ?? '',
            label: edge.label
          }))
          .filter((edge) => edge.source.length > 0 && edge.target.length > 0);

        if (nodes.length > 0) {
          return { nodes, edges };
        }
      } catch (error) {
        console.error('Failed to parse schematic.json', error);
      }
    }
  }

  return fallbackPayload();
}

function normalizeSourceLocation(
  source:
    | {
        file?: string;
        line?: number;
      }
    | undefined
): CircuitNode['sourceLocation'] {
  if (!source?.file) {
    return undefined;
  }
  return {
    file: normalizePath(source.file),
    line: source.line
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

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
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
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a workspace folder first.');
    return;
  }

  const candidatePaths = [
    path.resolve(workspaceFolder, relativePath),
    path.resolve(workspaceFolder, normalizePath(relativePath))
  ];
  const filePath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    vscode.window.showWarningMessage(`Source file not found: ${relativePath}`);
    return;
  }

  const document = await vscode.workspace.openTextDocument(filePath);
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  const targetLine = Math.max(0, line - 1);
  const targetPos = new vscode.Position(targetLine, 0);
  editor.selection = new vscode.Selection(targetPos, targetPos);
  editor.revealRange(new vscode.Range(targetPos, targetPos), vscode.TextEditorRevealType.InCenter);
}

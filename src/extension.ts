import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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

type RanvierProjectTarget = {
  root: string;
  label: string;
};

type SidebarProjectState = {
  options: RanvierProjectTarget[];
  selectedRoot?: string;
  scanning: boolean;
  message?: string;
  scannedAt?: string;
};

type ProjectDiscoveryCache = {
  options: RanvierProjectTarget[];
  scannedAt: string;
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
  private projectState: SidebarProjectState = { options: [], scanning: false };

  constructor(private readonly extensionUri: vscode.Uri) { }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getSidebarWebviewHtml(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage((message: {
      type?: string;
      payload?: { nodeId?: string; root?: string };
    }) => {
      if (!message?.type) return;
      if (message.type === 'ready') {
        this.postInit();
        return;
      }
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
        return;
      }
      if (message.type === 'set-target-project' && message.payload?.root) {
        void vscode.commands.executeCommand('ranvier.setProjectTarget', message.payload.root);
        return;
      }
      if (message.type === 'refresh-project-discovery') {
        void vscode.commands.executeCommand('ranvier.refreshProjectDiscovery');
      }
    });

    this.postInit();
  }

  update(
    payload: CircuitPayload,
    focusedNodeId: string | undefined,
    locale: string,
    projectState?: SidebarProjectState
  ): void {
    this.payload = payload;
    this.focusedNodeId = focusedNodeId;
    this.locale = locale;
    if (projectState) {
      this.projectState = projectState;
    }
    this.postInit();
  }

  setProjectState(projectState: SidebarProjectState): void {
    this.projectState = projectState;
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
        nodes,
        projectState: this.projectState
      }
    });
  }
}

let activePanel: vscode.WebviewPanel | null = null;
let preferredWorkspaceRoot: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const store = new CircuitStore();
  const sidebarProvider = new CircuitSidebarViewProvider(context.extensionUri);
  const problemCollection = vscode.languages.createDiagnosticCollection('ranvier');
  const workspaceSignature = createWorkspaceSignature();
  const discoveryCacheKey = workspaceSignature
    ? `ranvier.projectDiscovery.cache.${workspaceSignature}`
    : undefined;
  const selectedTargetKey = workspaceSignature
    ? `ranvier.projectDiscovery.selected.${workspaceSignature}`
    : undefined;
  let discoveredTargets: RanvierProjectTarget[] = [];
  let scanningProjects = false;
  let projectStatusMessage: string | undefined;
  let discoveredAtIso: string | undefined;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ranvierCircuitNodes', sidebarProvider)
  );
  let editorSyncTimer: NodeJS.Timeout | undefined;
  let lastPostedActiveFile: string | undefined;
  let lastPostedFocusedNodeId: string | undefined;

  const currentProjectState = (): SidebarProjectState => ({
    options: discoveredTargets,
    selectedRoot: preferredWorkspaceRoot,
    scanning: scanningProjects,
    message: projectStatusMessage,
    scannedAt: discoveredAtIso
  });

  const refreshAllViews = async (): Promise<void> => {
    const state = await store.refresh();
    syncProblemsPanel(state.payload, problemCollection);
    sidebarProvider.update(
      state.payload,
      findFocusedNodeIdFromEditorContext(state.payload, problemCollection),
      vscode.env.language,
      currentProjectState()
    );
    await postInit(activePanel?.webview, store);
  };

  const setPreferredTarget = async (root: string | undefined): Promise<void> => {
    preferredWorkspaceRoot = root;
    if (selectedTargetKey) {
      await context.workspaceState.update(selectedTargetKey, root ?? null);
    }
  };

  const restorePreferredTarget = async (): Promise<void> => {
    const restored = selectedTargetKey
      ? context.workspaceState.get<string | null>(selectedTargetKey, null)
      : null;
    const matched = restored
      ? discoveredTargets.find((target) => normalizePath(target.root) === normalizePath(restored))
      : undefined;
    if (matched) {
      await setPreferredTarget(matched.root);
      return;
    }
    await setPreferredTarget(discoveredTargets[0]?.root);
  };

  const discoverTargets = async (forceRefresh = false): Promise<void> => {
    if (scanningProjects) {
      return;
    }
    scanningProjects = true;
    projectStatusMessage = undefined;
    sidebarProvider.setProjectState(currentProjectState());

    try {
      if (!forceRefresh && discoveryCacheKey) {
        const cached = context.workspaceState.get<ProjectDiscoveryCache | RanvierProjectTarget[]>(
          discoveryCacheKey
        );
        if (cached) {
          if (Array.isArray(cached)) {
            discoveredTargets = cached.filter((item) => fs.existsSync(item.root));
            discoveredAtIso = undefined;
          } else {
            discoveredTargets = cached.options.filter((item) => fs.existsSync(item.root));
            discoveredAtIso = cached.scannedAt;
          }
          if (discoveredTargets.length === 0) {
            const rescanned = await discoverRanvierProjectTargets();
            discoveredTargets = rescanned;
            discoveredAtIso = new Date().toISOString();
            await context.workspaceState.update(discoveryCacheKey, {
              options: rescanned,
              scannedAt: discoveredAtIso
            } satisfies ProjectDiscoveryCache);
          }
          await restorePreferredTarget();
          projectStatusMessage =
            discoveredTargets.length === 0
              ? 'No Ranvier dependency project found.'
              : `${discoveredTargets.length} Ranvier project(s) detected.`;
          return;
        }
      }

      const scanned = await discoverRanvierProjectTargets();
      discoveredTargets = scanned;
      discoveredAtIso = new Date().toISOString();
      if (discoveryCacheKey) {
        await context.workspaceState.update(discoveryCacheKey, {
          options: scanned,
          scannedAt: discoveredAtIso
        } satisfies ProjectDiscoveryCache);
      }
      await restorePreferredTarget();
      projectStatusMessage =
        discoveredTargets.length === 0
          ? 'No Ranvier dependency project found.'
          : `${discoveredTargets.length} Ranvier project(s) detected.`;
    } finally {
      scanningProjects = false;
      sidebarProvider.setProjectState(currentProjectState());
    }
  };

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

  void discoverTargets()
    .then(() => refreshAllViews())
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
            const exportResult = await runSchematicExport(
              store,
              sidebarProvider,
              problemCollection,
              currentProjectState
            );
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
            await refreshAllViews();
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
      await refreshAllViews();
      vscode.window.showInformationMessage('Ranvier circuit data refreshed.');
    }),
    vscode.commands.registerCommand('ranvier.refreshDiagnostics', async () => {
      await refreshAllViews();
      vscode.window.showInformationMessage('Ranvier diagnostics refreshed.');
    }),
    vscode.commands.registerCommand('ranvier.exportSchematic', async () => {
      await runSchematicExport(store, sidebarProvider, problemCollection, currentProjectState);
    }),
    vscode.commands.registerCommand('ranvier.refreshProjectDiscovery', async () => {
      await discoverTargets(true);
      await refreshAllViews();
    }),
    vscode.commands.registerCommand('ranvier.setProjectTarget', async (root: string) => {
      if (!discoveredTargets.some((target) => normalizePath(target.root) === normalizePath(root))) {
        return;
      }
      await setPreferredTarget(root);
      projectStatusMessage = undefined;
      await refreshAllViews();
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

  void notifyMissingRanvierCli(context);
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
      content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style nonce="${nonce}">
      :root {
        color-scheme: light dark;
        --surface-1: color-mix(
          in srgb,
          var(--vscode-sideBar-background) 86%,
          var(--vscode-editor-background)
        );
        --surface-2: color-mix(
          in srgb,
          var(--vscode-sideBar-background) 74%,
          var(--vscode-editor-background)
        );
        --line-soft: color-mix(in srgb, var(--vscode-panel-border) 72%, transparent);
        --line-strong: color-mix(in srgb, var(--vscode-panel-border) 92%, transparent);
        --accent: color-mix(
          in srgb,
          var(--vscode-focusBorder) 70%,
          var(--vscode-textLink-foreground, var(--vscode-focusBorder))
        );
      }
      body {
        margin: 0;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        min-height: 100vh;
      }
      .bg {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background:
          radial-gradient(100% 45% at 12% 0%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 72%),
          radial-gradient(90% 38% at 90% 12%, color-mix(in srgb, var(--vscode-button-background) 20%, transparent), transparent 76%);
      }
      .wrap {
        display: grid;
        gap: 4px;
        padding: 6px;
        position: relative;
        z-index: 1;
      }
      .hero {
        border: 1px solid var(--line-soft);
        border-radius: 8px;
        background: linear-gradient(165deg, var(--surface-2), var(--surface-1));
        box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 5%, transparent);
        padding: 6px;
      }
      .hero-title {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .hero-sub {
        margin-top: 3px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .stats {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .chip {
        border: 1px solid var(--line-soft);
        border-radius: 999px;
        background: color-mix(in srgb, var(--surface-1) 86%, transparent);
        padding: 2px 6px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .target-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
        padding: 4px 6px;
        position: relative;
      }
      .target-display {
        appearance: none;
        width: 100%;
        text-align: left;
        border: 1px solid var(--line-soft);
        border-radius: 8px;
        background: color-mix(in srgb, var(--surface-2) 82%, transparent);
        color: var(--vscode-foreground);
        padding: 6px 8px;
        font-size: 11.5px;
        min-height: 16px;
        cursor: pointer;
        line-height: 1.25;
        white-space: normal;
        word-break: break-word;
      }
      .target-display:hover {
        border-color: var(--line-strong);
      }
      .target-display:focus-visible {
        outline: 1px solid var(--accent);
        outline-offset: 1px;
      }
      .target-panel {
        position: static;
        grid-column: 1 / -1;
        border: 1px solid var(--line-strong);
        border-radius: 9px;
        background: color-mix(in srgb, var(--surface-1) 92%, var(--vscode-editor-background));
        box-shadow: 0 10px 24px color-mix(in srgb, #000 32%, transparent);
        padding: 6px;
        display: grid;
        gap: 4px;
        margin-top: 2px;
      }
      .target-panel[hidden] {
        display: none;
      }
      .target-filter {
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: color-mix(in srgb, var(--surface-2) 82%, transparent);
        color: var(--vscode-foreground);
        font-size: 12px;
        padding: 6px 8px;
      }
      .target-filter:focus-visible {
        outline: 1px solid var(--accent);
        outline-offset: 1px;
      }
      .target-options {
        max-height: 300px;
        overflow: auto;
        display: grid;
        gap: 4px;
      }
      .target-option {
        width: 100%;
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: color-mix(in srgb, var(--surface-2) 74%, transparent);
        color: var(--vscode-foreground);
        text-align: left;
        padding: 7px 8px;
        cursor: pointer;
        font-size: 11.5px;
      }
      .target-option:hover {
        border-color: var(--line-strong);
      }
      .target-option.active {
        border-color: var(--accent);
        background: color-mix(
          in srgb,
          var(--vscode-list-activeSelectionBackground) 66%,
          var(--surface-2)
        );
      }
      .target-option-main {
        font-weight: 600;
      }
      .target-option-path {
        margin-top: 2px;
        color: var(--vscode-descriptionForeground);
        font-size: 10.5px;
        white-space: normal;
        word-break: break-word;
      }
      .target-empty {
        border: 1px dashed var(--line-soft);
        border-radius: 7px;
        padding: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .target-refresh {
        border: 1px solid var(--line-soft);
        border-radius: 8px;
        background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 85%, var(--surface-2));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .target-refresh:hover {
        border-color: var(--line-strong);
      }
      .target-hint {
        padding: 0 6px 6px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.25;
      }
      .section {
        border: 1px solid var(--line-soft);
        border-radius: 8px;
        overflow: hidden;
        background: var(--surface-1);
      }
      .title {
        font-size: 11px;
        letter-spacing: 0.05em;
        font-weight: 650;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        padding: 5px 6px 4px;
        border-bottom: 1px solid var(--line-soft);
      }
      .actions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 6px;
        padding: 4px 6px 6px;
      }
      button.action {
        border: 1px solid var(--line-soft);
        border-radius: 9px;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--vscode-button-background) 92%, transparent),
          color-mix(in srgb, var(--vscode-button-background) 72%, transparent)
        );
        color: var(--vscode-button-foreground, var(--vscode-foreground));
        padding: 7px 9px;
        text-align: left;
        cursor: pointer;
        font-size: 11.5px;
        font-weight: 600;
        transition: transform 120ms ease, border-color 120ms ease, filter 120ms ease;
      }
      button.action:hover {
        transform: translateY(-1px);
        border-color: var(--line-strong);
        filter: brightness(1.04);
      }
      button.action:focus-visible {
        outline: 1px solid var(--accent);
        outline-offset: 1px;
      }
      .nodes {
        display: grid;
        gap: 7px;
        overflow: visible;
        padding: 4px 6px 6px;
      }
      button.node {
        border: 1px solid var(--line-soft);
        border-radius: 9px;
        background: color-mix(in srgb, var(--surface-2) 72%, transparent);
        color: inherit;
        text-align: left;
        cursor: pointer;
        padding: 8px 9px;
        transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
      }
      button.node:hover {
        transform: translateY(-1px);
        border-color: var(--line-strong);
        background: color-mix(in srgb, var(--vscode-list-hoverBackground) 68%, var(--surface-2));
      }
      button.node.active {
        border-color: var(--accent);
        background: color-mix(
          in srgb,
          var(--vscode-list-activeSelectionBackground) 66%,
          var(--surface-2)
        );
      }
      button.node:disabled {
        opacity: 0.64;
        cursor: not-allowed;
      }
      .node-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .node-title {
        font-size: 12.5px;
        font-weight: 620;
        white-space: normal;
        word-break: break-word;
      }
      .node-badge {
        border-radius: 999px;
        border: 1px solid var(--line-soft);
        padding: 1px 6px;
        font-size: 10px;
        line-height: 1.35;
        color: var(--vscode-descriptionForeground);
        background: color-mix(in srgb, var(--surface-1) 80%, transparent);
      }
      .node-badge.ok {
        border-color: color-mix(in srgb, var(--vscode-testing-iconPassed) 45%, var(--line-soft));
        color: color-mix(in srgb, var(--vscode-testing-iconPassed) 75%, var(--vscode-foreground));
      }
      .node-badge.off {
        border-color: color-mix(in srgb, var(--vscode-disabledForeground) 70%, var(--line-soft));
        color: var(--vscode-disabledForeground);
      }
      .node-meta {
        margin-top: 5px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-family:
          ui-monospace,
          SFMono-Regular,
          Menlo,
          Monaco,
          Consolas,
          "Liberation Mono",
          "Courier New",
          monospace;
        white-space: normal;
        word-break: break-word;
      }
      .node-desc {
        margin-top: 5px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        white-space: normal;
        word-break: break-word;
      }
      .empty {
        padding: 10px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        border: 1px dashed var(--line-soft);
        border-radius: 9px;
        background: color-mix(in srgb, var(--surface-2) 65%, transparent);
      }
      @media (max-width: 320px) {
        .target-row {
          grid-template-columns: 1fr;
        }
        .target-refresh {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <div class="bg"></div>
    <div class="wrap">
      <section class="section">
        <div id="target-title" class="title">Target Project</div>
        <div class="target-row">
          <button id="choose-project" class="target-display" type="button"></button>
          <button id="refresh-projects" class="target-refresh" type="button">Rescan</button>
          <div id="target-panel" class="target-panel" hidden>
            <input id="target-filter" class="target-filter" type="text" />
            <div id="target-options" class="target-options"></div>
          </div>
        </div>
        <div id="target-hint" class="target-hint"></div>
      </section>
      <section class="hero">
        <div id="hero-title" class="hero-title">Ranvier Workspace</div>
        <div id="hero-sub" class="hero-sub">Quick overview for circuit workflow</div>
        <div class="stats">
          <div id="nodes-stat" class="chip">Nodes: 0</div>
          <div id="mapped-stat" class="chip">Mapped: 0</div>
        </div>
      </section>
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
      const heroTitle = document.getElementById('hero-title');
      const heroSub = document.getElementById('hero-sub');
      const nodesStat = document.getElementById('nodes-stat');
      const mappedStat = document.getElementById('mapped-stat');
      const targetTitle = document.getElementById('target-title');
      const chooseProject = document.getElementById('choose-project');
      const targetPanel = document.getElementById('target-panel');
      const targetFilter = document.getElementById('target-filter');
      const targetOptions = document.getElementById('target-options');
      const targetHint = document.getElementById('target-hint');
      const refreshProjects = document.getElementById('refresh-projects');
      const actionsTitle = document.getElementById('actions-title');
      const nodesTitle = document.getElementById('nodes-title');
      const refreshCircuit = document.getElementById('refresh-circuit');
      const runExport = document.getElementById('run-export');
      const refreshDiagnostics = document.getElementById('refresh-diagnostics');
      const labelsByLocale = {
        ko: {
          workspace: 'Ranvier 워크스페이스',
          workspaceSub: '회로 워크플로 요약',
          workspaceSubSelected: '현재 대상',
          nodesStat: '노드',
          mappedStat: '매핑',
          targetTitle: '대상 프로젝트',
          targetChoose: '프로젝트 선택',
          targetFilterPlaceholder: '프로젝트 검색',
          targetRefresh: '새로 탐색',
          targetNone: 'Ranvier 의존 프로젝트가 없습니다',
          targetScanning: 'Ranvier 의존 프로젝트를 탐색 중입니다...',
          targetLastScan: '마지막 탐색',
          targetNoMatch: '검색 결과가 없습니다',
          actions: '빠른 작업',
          nodes: '회로 노드',
          refreshCircuit: '회로 데이터 새로고침',
          runExport: 'Schematic Export 실행',
          refreshDiagnostics: '진단 새로고침',
          noNodes: '표시할 노드가 없습니다.',
          noSource: '소스 매핑 없음',
          mapped: 'Mapped',
          unmapped: 'Unmapped',
          clickToOpen: '클릭해서 소스 열기'
        },
        en: {
          workspace: 'Ranvier Workspace',
          workspaceSub: 'Quick overview for circuit workflow',
          workspaceSubSelected: 'Current target',
          nodesStat: 'Nodes',
          mappedStat: 'Mapped',
          targetTitle: 'Target Project',
          targetChoose: 'Choose project',
          targetFilterPlaceholder: 'Filter projects',
          targetRefresh: 'Rescan',
          targetNone: 'No Ranvier dependency project found',
          targetScanning: 'Scanning workspace for Ranvier dependencies...',
          targetLastScan: 'Last scan',
          targetNoMatch: 'No matching project',
          actions: 'Quick Actions',
          nodes: 'Circuit Nodes',
          refreshCircuit: 'Refresh Circuit Data',
          runExport: 'Run Schematic Export',
          refreshDiagnostics: 'Refresh Diagnostics',
          noNodes: 'No nodes to display.',
          noSource: 'No source mapping',
          mapped: 'Mapped',
          unmapped: 'Unmapped',
          clickToOpen: 'Click to open source'
        }
      };
      let current = {
        locale: 'en',
        focusedNodeId: undefined,
        nodes: [],
        projectState: {
          options: [],
          selectedRoot: undefined,
          scanning: false,
          message: undefined,
          scannedAt: undefined
        }
      };
      let targetPanelOpen = false;
      let targetFilterValue = '';

      function t() {
        return current.locale.startsWith('ko') ? labelsByLocale.ko : labelsByLocale.en;
      }

      function getFilteredTargetOptions(projectState) {
        const raw = (targetFilterValue || '').trim();
        if (!raw) {
          return projectState.options;
        }
        const tokens = raw
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean);
        if (!tokens.length) {
          return projectState.options;
        }
        return projectState.options.filter((item) => {
          const haystack = (item.label + ' ' + item.root).toLowerCase();
          return tokens.every((token) => haystack.includes(token.toLowerCase()));
        });
      }

      function closeTargetPanel() {
        targetPanelOpen = false;
        targetPanel.hidden = true;
      }

      function openTargetPanel() {
        targetPanelOpen = true;
        targetPanel.hidden = false;
        targetFilter.focus();
      }

      function render() {
        const labels = t();
        const projectState = current.projectState || {
          options: [],
          selectedRoot: undefined,
          scanning: false,
          message: undefined,
          scannedAt: undefined
        };
        const selectedTarget = projectState.options.find((item) => item.root === projectState.selectedRoot);
        const mappedCount = current.nodes.filter((node) => node.mapped).length;
        heroTitle.textContent = labels.workspace;
        heroSub.textContent = selectedTarget
          ? labels.workspaceSubSelected + ': ' + selectedTarget.label
          : labels.workspaceSub;
        nodesStat.textContent = labels.nodesStat + ': ' + current.nodes.length;
        mappedStat.textContent = labels.mappedStat + ': ' + mappedCount;
        targetTitle.textContent = labels.targetTitle;
        chooseProject.textContent = selectedTarget ? selectedTarget.label : labels.targetChoose;
        refreshProjects.textContent = labels.targetRefresh;
        targetFilter.placeholder = labels.targetFilterPlaceholder;
        actionsTitle.textContent = labels.actions;
        nodesTitle.textContent = labels.nodes;
        refreshCircuit.textContent = labels.refreshCircuit;
        runExport.textContent = labels.runExport;
        refreshDiagnostics.textContent = labels.refreshDiagnostics;

        chooseProject.disabled = projectState.scanning || projectState.options.length === 0;
        refreshProjects.disabled = projectState.scanning;
        if (projectState.scanning || projectState.options.length === 0) {
          closeTargetPanel();
        }
        const scanHint = projectState.scannedAt
          ? labels.targetLastScan + ': ' + new Date(projectState.scannedAt).toLocaleString()
          : '';
        targetHint.textContent = projectState.scanning
          ? labels.targetScanning
          : projectState.message
            ? projectState.message + (scanHint ? ' | ' + scanHint : '')
            : scanHint || (projectState.options.length ? '' : labels.targetNone);
        const hasTarget = Boolean(projectState.selectedRoot);
        refreshCircuit.disabled = !hasTarget;
        runExport.disabled = !hasTarget;
        refreshDiagnostics.disabled = !hasTarget;

        const filtered = getFilteredTargetOptions(projectState);
        targetOptions.innerHTML = '';
        if (targetPanelOpen) {
          if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'target-empty';
            empty.textContent = labels.targetNoMatch;
            targetOptions.appendChild(empty);
          } else {
            for (const option of filtered) {
              const item = document.createElement('button');
              item.type = 'button';
              item.className = 'target-option';
              if (projectState.selectedRoot === option.root) {
                item.classList.add('active');
              }
              item.addEventListener('click', () => {
                closeTargetPanel();
                targetFilterValue = '';
                targetFilter.value = '';
                vscode.postMessage({ type: 'set-target-project', payload: { root: option.root } });
              });

              const main = document.createElement('div');
              main.className = 'target-option-main';
              main.textContent = option.label;
              item.appendChild(main);

              const pathText = document.createElement('div');
              pathText.className = 'target-option-path';
              pathText.textContent = option.root;
              item.appendChild(pathText);

              targetOptions.appendChild(item);
            }
          }
        }

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

          const top = document.createElement('div');
          top.className = 'node-top';

          const title = document.createElement('div');
          title.className = 'node-title';
          title.textContent = node.label;
          top.appendChild(title);

          const badge = document.createElement('div');
          badge.className = 'node-badge ' + (node.mapped ? 'ok' : 'off');
          badge.textContent = node.mapped ? labels.mapped : labels.unmapped;
          top.appendChild(badge);
          btn.appendChild(top);

          const meta = document.createElement('div');
          meta.className = 'node-meta';
          meta.textContent = node.id;
          btn.appendChild(meta);

          const desc = document.createElement('div');
          desc.className = 'node-desc';
          desc.textContent = node.mapped ? labels.clickToOpen : labels.noSource;
          btn.appendChild(desc);

          nodesRoot.appendChild(btn);
        }
      }

      chooseProject.addEventListener('click', (event) => {
        event.stopPropagation();
        if (targetPanelOpen) {
          closeTargetPanel();
          return;
        }
        openTargetPanel();
        render();
      });
      targetFilter.addEventListener('input', (event) => {
        targetFilterValue = event.target?.value || '';
        render();
      });
      targetFilter.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closeTargetPanel();
          render();
        }
      });
      refreshProjects.addEventListener('click', () => {
        closeTargetPanel();
        vscode.postMessage({ type: 'refresh-project-discovery' });
      });
      refreshCircuit.addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh-circuit' });
      });
      runExport.addEventListener('click', () => {
        vscode.postMessage({ type: 'run-export' });
      });
      refreshDiagnostics.addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh-diagnostics' });
      });
      document.addEventListener('click', (event) => {
        if (!targetPanelOpen) return;
        if (targetPanel.contains(event.target) || chooseProject.contains(event.target)) {
          return;
        }
        closeTargetPanel();
        render();
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
      vscode.postMessage({ type: 'ready' });
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
  const workspaceFolder = resolveTargetWorkspaceRoot();
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
  problemCollection: vscode.DiagnosticCollection,
  getProjectState?: () => SidebarProjectState
): Promise<{ ok: boolean; message: string }> {
  const workspaceFolder = resolveTargetWorkspaceRoot();
  if (!workspaceFolder) {
    const message = 'Ranvier schematic export failed: select a Ranvier project target first.';
    vscode.window.showWarningMessage(message);
    return { ok: false, message };
  }
  if (!fs.existsSync(workspaceFolder)) {
    const message =
      `Ranvier schematic export failed: target path does not exist (${workspaceFolder}). ` +
      'Rescan target projects and select a valid project.';
    vscode.window.showErrorMessage(message);
    return { ok: false, message };
  }

  const config = vscode.workspace.getConfiguration('ranvier');
  const example = await resolveSchematicExportExample(config, workspaceFolder);
  const outputPath = config.get<string>('schematicExport.outputPath', 'schematic.json');

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
    const ranvierArgs = ['schematic', example, '--output', outputPath];

    const ranvierResult = await runCommand('ranvier', ranvierArgs);
    if (ranvierResult.ok) {
      const state = await store.refresh();
      syncProblemsPanel(state.payload, problemCollection);
      sidebarProvider.update(
        state.payload,
        findFocusedNodeIdFromEditorContext(state.payload, problemCollection),
        vscode.env.language,
        getProjectState ? getProjectState() : undefined
      );
      await postInit(activePanel?.webview, store);
      const message = `Ranvier schematic exported: ${outputPath}`;
      vscode.window.showInformationMessage(message);
      return { ok: true, message };
    }

    const ranvierFailure = ranvierResult.spawnError ?? ranvierResult.stderrTail ?? 'unknown error';
    if (isInvalidDirectoryError(ranvierFailure)) {
      const message =
        'Ranvier schematic export failed: ranvier-cli reported an invalid directory error (os error 267). ' +
        'Update ranvier-cli to the latest version and run again.';
      vscode.window.showErrorMessage(message);
      return { ok: false, message };
    }
    const message =
      `Ranvier schematic export failed: ${ranvierFailure}. ` +
      'Install ranvier-cli (`cargo install ranvier-cli`) and ensure `ranvier` is in PATH.';
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

async function resolveSchematicExportExample(
  config: vscode.WorkspaceConfiguration,
  workspaceFolder: string
): Promise<string> {
  const configured = config.get<string>('schematicExport.example', 'basic-schematic')?.trim();
  const inspected = config.inspect<string>('schematicExport.example');
  const hasUserOverride = Boolean(
    inspected &&
      (inspected.globalValue !== undefined ||
        inspected.workspaceValue !== undefined ||
        inspected.workspaceFolderValue !== undefined)
  );

  if (hasUserOverride && configured) {
    return configured;
  }
  if (configured && configured !== 'basic-schematic') {
    return configured;
  }

  const suggested = await suggestExampleNameFromProjectRoot(workspaceFolder);
  if (suggested) {
    return suggested;
  }
  return configured || 'basic-schematic';
}

async function suggestExampleNameFromProjectRoot(projectRoot: string): Promise<string | undefined> {
  const cargoToml = path.join(projectRoot, 'Cargo.toml');
  if (fs.existsSync(cargoToml)) {
    try {
      const raw = await fs.promises.readFile(cargoToml, 'utf8');
      const name = extractPackageNameFromCargoToml(raw);
      if (name) {
        return name;
      }
    } catch {
      // Ignore and continue fallback chain.
    }
  }

  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const raw = await fs.promises.readFile(packageJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as { name?: unknown };
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        return parsed.name.trim();
      }
    } catch {
      // Ignore and continue fallback chain.
    }
  }

  const folderName = path.basename(projectRoot).trim();
  return folderName || undefined;
}

function isInvalidDirectoryError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('os error 267') ||
    lower.includes('directory name is invalid') ||
    lower.includes('the directory name is invalid')
  );
}

async function notifyMissingRanvierCli(context: vscode.ExtensionContext): Promise<void> {
  const hasRanvier = await canRunRanvierCli();
  if (hasRanvier) {
    return;
  }

  const key = 'ranvier.cliMissingNoticeShown';
  const alreadyShown = context.globalState.get<boolean>(key, false);
  if (alreadyShown) {
    return;
  }
  await context.globalState.update(key, true);

  vscode.window.showWarningMessage(
    'Ranvier CLI (`ranvier`) not found in PATH. Install with `cargo install ranvier-cli`.'
  );
}

function canRunRanvierCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ranvier', ['--version'], {
      shell: process.platform === 'win32'
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

const IGNORED_SCAN_DIRS = new Set([
  '.git',
  '.jj',
  '.idea',
  '.vscode',
  'node_modules',
  'target',
  'dist',
  'build',
  '.svelte-kit',
  '.next',
  '.turbo',
  'coverage'
]);

function createWorkspaceSignature(): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return undefined;
  }
  const payload = folders
    .map((folder) => normalizePath(folder.uri.fsPath))
    .sort()
    .join('|');
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

async function discoverRanvierProjectTargets(): Promise<RanvierProjectTarget[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    return [];
  }

  const found = new Map<string, RanvierProjectTarget>();
  for (const folder of workspaceFolders) {
    const root = folder.uri.fsPath;
    const targets = await discoverRanvierTargetsUnderWorkspace(root);
    for (const target of targets) {
      const key = normalizePath(target.root);
      if (!found.has(key)) {
        found.set(key, target);
      }
    }
  }

  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function discoverRanvierTargetsUnderWorkspace(workspaceRoot: string): Promise<RanvierProjectTarget[]> {
  const results: RanvierProjectTarget[] = [];
  const stack = [workspaceRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    const hasCargoManifest = entries.some((entry) => entry.isFile() && entry.name === 'Cargo.toml');
    const hasPackageJson = entries.some((entry) => entry.isFile() && entry.name === 'package.json');

    if (hasCargoManifest) {
      const cargoPath = path.join(current, 'Cargo.toml');
      if (await cargoManifestDependsOnRanvier(cargoPath)) {
        results.push({
          root: current,
          label: formatProjectLabel(current, workspaceRoot)
        });
      }
    } else if (hasPackageJson) {
      const packageJsonPath = path.join(current, 'package.json');
      if (await packageJsonDependsOnRanvier(packageJsonPath)) {
        results.push({
          root: current,
          label: formatProjectLabel(current, workspaceRoot)
        });
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.isSymbolicLink()) continue;
      if (IGNORED_SCAN_DIRS.has(entry.name)) continue;
      stack.push(path.join(current, entry.name));
    }
  }

  return results;
}

function formatProjectLabel(projectRoot: string, workspaceRoot: string): string {
  const rel = normalizePath(path.relative(workspaceRoot, projectRoot));
  if (!rel || rel === '.') {
    return `${path.basename(workspaceRoot)} (workspace root)`;
  }
  return `${path.basename(projectRoot)} (${rel})`;
}

async function cargoManifestDependsOnRanvier(manifestPath: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf8');
    return tomlDependsOnRanvier(raw);
  } catch {
    return false;
  }
}

function tomlDependsOnRanvier(raw: string): boolean {
  const lines = raw.split(/\r?\n/);
  let inDependencySection = false;

  for (const line of lines) {
    const withoutComment = line.replace(/#.*/, '').trim();
    if (!withoutComment) continue;

    const section = withoutComment.match(/^\[([^\]]+)\]$/);
    if (section) {
      const sectionName = section[1]?.trim() ?? '';
      inDependencySection = isDependencySection(sectionName);
      continue;
    }
    if (!inDependencySection) {
      continue;
    }

    const keyMatch = withoutComment.match(/^([A-Za-z0-9_-]+)\s*=/);
    if (!keyMatch) {
      continue;
    }
    const key = keyMatch[1] ?? '';
    if (key.startsWith('ranvier')) {
      return true;
    }
    if (/package\s*=\s*"ranvier[^"]*"/.test(withoutComment)) {
      return true;
    }
  }

  return false;
}

function extractPackageNameFromCargoToml(raw: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  let inPackageSection = false;

  for (const line of lines) {
    const withoutComment = line.replace(/#.*/, '').trim();
    if (!withoutComment) continue;

    const section = withoutComment.match(/^\[([^\]]+)\]$/);
    if (section) {
      inPackageSection = (section[1]?.trim() ?? '') === 'package';
      continue;
    }
    if (!inPackageSection) {
      continue;
    }

    const match = withoutComment.match(/^name\s*=\s*"([^"]+)"/);
    if (match && match[1]?.trim()) {
      return match[1].trim();
    }
  }

  return undefined;
}

function isDependencySection(sectionName: string): boolean {
  return (
    sectionName === 'dependencies' ||
    sectionName === 'dev-dependencies' ||
    sectionName === 'build-dependencies' ||
    sectionName.endsWith('.dependencies') ||
    sectionName.endsWith('.dev-dependencies') ||
    sectionName.endsWith('.build-dependencies')
  );
}

async function packageJsonDependsOnRanvier(packageJsonPath: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sections = [
      parsed.dependencies,
      parsed.devDependencies,
      parsed.peerDependencies,
      parsed.optionalDependencies
    ];
    for (const section of sections) {
      if (!section || typeof section !== 'object') continue;
      const names = Object.keys(section as Record<string, unknown>);
      if (names.some((name) => name.startsWith('ranvier') || name.startsWith('@ranvier/'))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
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

function resolveTargetWorkspaceRoot(): string | undefined {
  return preferredWorkspaceRoot;
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

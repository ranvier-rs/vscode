import { SidebarTemplateData } from './template-types';

export function getSidebarWebviewHtml(data: SidebarTemplateData): string {
    const { webview, htmlLang, nonce, initialTranslations } = data;

    return `<!doctype html>
<html lang="${htmlLang}">
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
      const initialTranslations = ${JSON.stringify(initialTranslations)};
      let current = {
        locale: '${htmlLang}',
        focusedNodeId: undefined,
        nodes: [],
        projectState: {
          options: [],
          selectedRoot: undefined,
          scanning: false,
          message: undefined,
          scannedAt: undefined
        },
        translations: initialTranslations
      };
      let targetPanelOpen = false;
      let targetFilterValue = '';

      function t() {
        return current.translations.sidebar;
      }

      function getFilteredTargetOptions(projectState) {
        const raw = (targetFilterValue || '').trim();
        if (!raw) {
          return projectState.options;
        }
        const tokens = raw
          .split(/\\s+/)
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

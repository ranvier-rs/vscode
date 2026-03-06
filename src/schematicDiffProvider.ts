import * as fs from 'node:fs';
import * as vscode from 'vscode';

// ── Schematic JSON types (M228) ─────────────────────────────────

/**
 * Node kind can be a plain string ("Ingress", "Atom", "Synapse", "Egress")
 * or a structured variant like `{ Subgraph: { ... } }`.
 */
type SchematicNodeKind = string | { Subgraph: Record<string, unknown> };

type SchematicNode = {
  id: string;
  kind: SchematicNodeKind;
  label: string;
  input_type?: string;
  output_type?: string;
  resource_type?: string;
  [key: string]: unknown;
};

type SchematicEdge = {
  from: string;
  to: string;
  kind?: string;
  label?: string;
};

type SchematicJson = {
  schema_version: string;
  id: string;
  name: string;
  nodes: SchematicNode[];
  edges: SchematicEdge[];
};

// ── Diff computation types ──────────────────────────────────────

type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';

type NodeDiff = {
  id: string;
  status: DiffStatus;
  left?: SchematicNode;
  right?: SchematicNode;
  changes?: string[];
};

type EdgeDiff = {
  key: string;
  status: DiffStatus;
  left?: SchematicEdge;
  right?: SchematicEdge;
  changes?: string[];
};

type SchematicDiffResult = {
  leftName: string;
  rightName: string;
  leftVersion: string;
  rightVersion: string;
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  summary: {
    nodesAdded: number;
    nodesRemoved: number;
    nodesModified: number;
    nodesUnchanged: number;
    edgesAdded: number;
    edgesRemoved: number;
    edgesModified: number;
    edgesUnchanged: number;
  };
};

// ── Diff engine ─────────────────────────────────────────────────

function normalizeKind(kind: SchematicNodeKind): string {
  if (typeof kind === 'string') {
    return kind;
  }
  return JSON.stringify(kind);
}

function diffNodes(leftNodes: SchematicNode[], rightNodes: SchematicNode[]): NodeDiff[] {
  const leftMap = new Map<string, SchematicNode>();
  for (const node of leftNodes) {
    leftMap.set(node.id, node);
  }

  const rightMap = new Map<string, SchematicNode>();
  for (const node of rightNodes) {
    rightMap.set(node.id, node);
  }

  const allIds = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const diffs: NodeDiff[] = [];

  for (const id of allIds) {
    const left = leftMap.get(id);
    const right = rightMap.get(id);

    if (!left && right) {
      diffs.push({ id, status: 'added', right });
    } else if (left && !right) {
      diffs.push({ id, status: 'removed', left });
    } else if (left && right) {
      const changes = computeNodeChanges(left, right);
      if (changes.length > 0) {
        diffs.push({ id, status: 'modified', left, right, changes });
      } else {
        diffs.push({ id, status: 'unchanged', left, right });
      }
    }
  }

  // Sort: removed first, then modified, then added, then unchanged
  const order: Record<DiffStatus, number> = { removed: 0, modified: 1, added: 2, unchanged: 3 };
  diffs.sort((a, b) => order[a.status] - order[b.status]);

  return diffs;
}

function computeNodeChanges(left: SchematicNode, right: SchematicNode): string[] {
  const changes: string[] = [];

  if (left.label !== right.label) {
    changes.push(`label: "${left.label}" -> "${right.label}"`);
  }
  if (normalizeKind(left.kind) !== normalizeKind(right.kind)) {
    changes.push(`kind: ${normalizeKind(left.kind)} -> ${normalizeKind(right.kind)}`);
  }
  if ((left.input_type ?? '') !== (right.input_type ?? '')) {
    changes.push(`input_type: "${left.input_type ?? ''}" -> "${right.input_type ?? ''}"`);
  }
  if ((left.output_type ?? '') !== (right.output_type ?? '')) {
    changes.push(`output_type: "${left.output_type ?? ''}" -> "${right.output_type ?? ''}"`);
  }
  if ((left.resource_type ?? '') !== (right.resource_type ?? '')) {
    changes.push(`resource_type: "${left.resource_type ?? ''}" -> "${right.resource_type ?? ''}"`);
  }

  return changes;
}

function edgeKey(edge: SchematicEdge): string {
  return `${edge.from}->${edge.to}:${edge.kind ?? ''}`;
}

function diffEdges(leftEdges: SchematicEdge[], rightEdges: SchematicEdge[]): EdgeDiff[] {
  const leftMap = new Map<string, SchematicEdge>();
  for (const edge of leftEdges) {
    leftMap.set(edgeKey(edge), edge);
  }

  const rightMap = new Map<string, SchematicEdge>();
  for (const edge of rightEdges) {
    rightMap.set(edgeKey(edge), edge);
  }

  const allKeys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const diffs: EdgeDiff[] = [];

  for (const key of allKeys) {
    const left = leftMap.get(key);
    const right = rightMap.get(key);

    if (!left && right) {
      diffs.push({ key, status: 'added', right });
    } else if (left && !right) {
      diffs.push({ key, status: 'removed', left });
    } else if (left && right) {
      const changes: string[] = [];
      if ((left.label ?? '') !== (right.label ?? '')) {
        changes.push(`label: "${left.label ?? ''}" -> "${right.label ?? ''}"`);
      }
      if (changes.length > 0) {
        diffs.push({ key, status: 'modified', left, right, changes });
      } else {
        diffs.push({ key, status: 'unchanged', left, right });
      }
    }
  }

  const order: Record<DiffStatus, number> = { removed: 0, modified: 1, added: 2, unchanged: 3 };
  diffs.sort((a, b) => order[a.status] - order[b.status]);

  return diffs;
}

function computeDiff(left: SchematicJson, right: SchematicJson): SchematicDiffResult {
  const nodeDiffs = diffNodes(left.nodes ?? [], right.nodes ?? []);
  const edgeDiffs = diffEdges(left.edges ?? [], right.edges ?? []);

  const summary = {
    nodesAdded: nodeDiffs.filter(d => d.status === 'added').length,
    nodesRemoved: nodeDiffs.filter(d => d.status === 'removed').length,
    nodesModified: nodeDiffs.filter(d => d.status === 'modified').length,
    nodesUnchanged: nodeDiffs.filter(d => d.status === 'unchanged').length,
    edgesAdded: edgeDiffs.filter(d => d.status === 'added').length,
    edgesRemoved: edgeDiffs.filter(d => d.status === 'removed').length,
    edgesModified: edgeDiffs.filter(d => d.status === 'modified').length,
    edgesUnchanged: edgeDiffs.filter(d => d.status === 'unchanged').length,
  };

  return {
    leftName: left.name ?? left.id ?? 'Left',
    rightName: right.name ?? right.id ?? 'Right',
    leftVersion: left.schema_version ?? '?',
    rightVersion: right.schema_version ?? '?',
    nodes: nodeDiffs,
    edges: edgeDiffs,
    summary,
  };
}

// ── File picker & loader ────────────────────────────────────────

async function pickSchematicFile(title: string): Promise<SchematicJson | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    title,
    filters: {
      'Schematic JSON': ['json'],
    },
  });

  if (!uris || uris.length === 0) {
    return undefined;
  }

  const uri = uris[0];
  if (!uri) {
    return undefined;
  }

  try {
    const raw = await fs.promises.readFile(uri.fsPath, 'utf8');
    const parsed = JSON.parse(raw) as SchematicJson;
    if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
      vscode.window.showErrorMessage(
        `Invalid Schematic JSON: missing or non-array "nodes" field in ${uri.fsPath}`
      );
      return undefined;
    }
    return parsed;
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to read Schematic file: ${err}`);
    return undefined;
  }
}

// ── Webview HTML generation ─────────────────────────────────────

function getDiffWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  diff: SchematicDiffResult
): string {
  const nonce = String(Date.now());
  const cspSource = webview.cspSource;

  const diffJson = JSON.stringify(diff)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>Schematic Diff</title>
  <style nonce="${nonce}">
    :root {
      --added-bg: rgba(40, 167, 69, 0.15);
      --added-border: #28a745;
      --removed-bg: rgba(220, 53, 69, 0.15);
      --removed-border: #dc3545;
      --modified-bg: rgba(255, 193, 7, 0.15);
      --modified-border: #ffc107;
      --unchanged-bg: transparent;
      --unchanged-border: var(--vscode-panel-border, #444);
      --card-bg: var(--vscode-editor-background, #1e1e1e);
      --text-color: var(--vscode-foreground, #ccc);
      --text-muted: var(--vscode-descriptionForeground, #888);
      --header-bg: var(--vscode-sideBar-background, #252526);
      --badge-font: var(--vscode-font-family, monospace);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--text-color);
      background: var(--vscode-editor-background, #1e1e1e);
      padding: 16px;
      overflow-y: auto;
    }

    h1 {
      font-size: 1.4em;
      margin-bottom: 8px;
      font-weight: 600;
    }

    h2 {
      font-size: 1.15em;
      margin-top: 20px;
      margin-bottom: 10px;
      font-weight: 600;
      border-bottom: 1px solid var(--vscode-panel-border, #444);
      padding-bottom: 4px;
    }

    .header-row {
      display: flex;
      gap: 16px;
      align-items: baseline;
      margin-bottom: 4px;
    }

    .header-row .version {
      color: var(--text-muted);
      font-size: 0.9em;
    }

    /* ── Summary panel ── */
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 12px 0 8px;
    }

    .summary-card {
      background: var(--header-bg);
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 6px;
      padding: 10px 16px;
      min-width: 120px;
      text-align: center;
    }

    .summary-card .count {
      font-size: 1.8em;
      font-weight: 700;
      line-height: 1.2;
      font-family: var(--badge-font);
    }

    .summary-card .label {
      font-size: 0.85em;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .count-added { color: var(--added-border); }
    .count-removed { color: var(--removed-border); }
    .count-modified { color: var(--modified-border); }
    .count-unchanged { color: var(--text-muted); }

    /* ── Diff table ── */
    .diff-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      margin-top: 8px;
    }

    .diff-grid-header {
      display: contents;
    }

    .diff-grid-header > div {
      background: var(--header-bg);
      padding: 8px 12px;
      font-weight: 600;
      border-bottom: 2px solid var(--vscode-panel-border, #444);
    }

    .diff-row {
      display: contents;
    }

    .diff-cell {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      min-height: 42px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .diff-cell.added {
      background: var(--added-bg);
      border-left: 3px solid var(--added-border);
    }

    .diff-cell.removed {
      background: var(--removed-bg);
      border-left: 3px solid var(--removed-border);
    }

    .diff-cell.modified {
      background: var(--modified-bg);
      border-left: 3px solid var(--modified-border);
    }

    .diff-cell.unchanged {
      background: var(--unchanged-bg);
      border-left: 3px solid transparent;
    }

    .diff-cell.empty {
      background: var(--header-bg);
      opacity: 0.4;
      border-left: 3px solid transparent;
    }

    .node-id {
      font-weight: 600;
      font-family: var(--badge-font);
    }

    .node-kind {
      font-size: 0.85em;
      color: var(--text-muted);
    }

    .node-types {
      font-size: 0.82em;
      color: var(--text-muted);
      font-family: var(--badge-font);
    }

    .change-list {
      font-size: 0.82em;
      list-style: none;
      padding-left: 8px;
      margin-top: 2px;
    }

    .change-list li::before {
      content: "~ ";
      color: var(--modified-border);
      font-weight: bold;
    }

    .badge {
      display: inline-block;
      font-size: 0.75em;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 3px;
      text-transform: uppercase;
      vertical-align: middle;
      margin-left: 6px;
    }

    .badge-added { background: var(--added-bg); color: var(--added-border); border: 1px solid var(--added-border); }
    .badge-removed { background: var(--removed-bg); color: var(--removed-border); border: 1px solid var(--removed-border); }
    .badge-modified { background: var(--modified-bg); color: var(--modified-border); border: 1px solid var(--modified-border); }

    .edge-label {
      font-family: var(--badge-font);
      font-size: 0.9em;
    }

    .filter-bar {
      display: flex;
      gap: 8px;
      margin: 8px 0 4px;
      flex-wrap: wrap;
    }

    .filter-btn {
      background: var(--header-bg);
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 4px;
      padding: 4px 12px;
      color: var(--text-color);
      cursor: pointer;
      font-size: 0.85em;
      font-family: inherit;
    }

    .filter-btn:hover {
      border-color: var(--vscode-focusBorder, #007fd4);
    }

    .filter-btn.active {
      border-color: var(--vscode-focusBorder, #007fd4);
      background: var(--vscode-list-activeSelectionBackground, #094771);
      color: var(--vscode-list-activeSelectionForeground, #fff);
    }

    .no-changes {
      color: var(--text-muted);
      font-style: italic;
      padding: 12px;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    (function() {
      const diff = JSON.parse(${JSON.stringify(diffJson)});
      const app = document.getElementById('app');

      let nodeFilter = 'all';
      let edgeFilter = 'all';

      function esc(s) {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function renderNodeCell(node, status) {
        if (!node) return '<div class="diff-cell empty">&mdash;</div>';
        const kindStr = typeof node.kind === 'string' ? node.kind : JSON.stringify(node.kind);
        const types = [];
        if (node.input_type) types.push('in: ' + esc(node.input_type));
        if (node.output_type) types.push('out: ' + esc(node.output_type));
        if (node.resource_type) types.push('res: ' + esc(node.resource_type));

        return '<div class="diff-cell ' + esc(status) + '">'
          + '<span class="node-id">' + esc(node.id) + '</span>'
          + '<span class="node-kind">' + esc(node.label) + ' (' + esc(kindStr) + ')</span>'
          + (types.length > 0 ? '<span class="node-types">' + types.join(' | ') + '</span>' : '')
          + '</div>';
      }

      function renderEdgeCell(edge, status) {
        if (!edge) return '<div class="diff-cell empty">&mdash;</div>';
        return '<div class="diff-cell ' + esc(status) + '">'
          + '<span class="edge-label">' + esc(edge.from) + ' &rarr; ' + esc(edge.to) + '</span>'
          + (edge.kind ? '<span class="node-kind">' + esc(edge.kind) + '</span>' : '')
          + (edge.label ? '<span class="node-types">' + esc(edge.label) + '</span>' : '')
          + '</div>';
      }

      function badgeFor(status) {
        if (status === 'unchanged') return '';
        return '<span class="badge badge-' + status + '">' + status + '</span>';
      }

      function renderChanges(changes) {
        if (!changes || changes.length === 0) return '';
        return '<ul class="change-list">' + changes.map(function(c) {
          return '<li>' + esc(c) + '</li>';
        }).join('') + '</ul>';
      }

      function render() {
        const s = diff.summary;
        let html = '';

        // Title
        html += '<h1>Schematic Diff</h1>';
        html += '<div class="header-row">'
          + '<span><strong>' + esc(diff.leftName) + '</strong> <span class="version">v' + esc(diff.leftVersion) + '</span></span>'
          + '<span>&harr;</span>'
          + '<span><strong>' + esc(diff.rightName) + '</strong> <span class="version">v' + esc(diff.rightVersion) + '</span></span>'
          + '</div>';

        // Summary
        html += '<div class="summary">';
        html += summaryCard(s.nodesAdded, 'Nodes Added', 'added');
        html += summaryCard(s.nodesRemoved, 'Nodes Removed', 'removed');
        html += summaryCard(s.nodesModified, 'Nodes Modified', 'modified');
        html += summaryCard(s.nodesUnchanged, 'Nodes Unchanged', 'unchanged');
        html += summaryCard(s.edgesAdded, 'Edges Added', 'added');
        html += summaryCard(s.edgesRemoved, 'Edges Removed', 'removed');
        html += summaryCard(s.edgesModified, 'Edges Modified', 'modified');
        html += summaryCard(s.edgesUnchanged, 'Edges Unchanged', 'unchanged');
        html += '</div>';

        // Nodes section
        html += '<h2>Nodes</h2>';
        html += renderFilterBar('node');
        const filteredNodes = diff.nodes.filter(function(d) {
          return nodeFilter === 'all' || d.status === nodeFilter;
        });
        if (filteredNodes.length === 0) {
          html += '<div class="no-changes">No node differences to show.</div>';
        } else {
          html += '<div class="diff-grid">';
          html += '<div class="diff-grid-header"><div>' + esc(diff.leftName) + ' (Left)</div><div>' + esc(diff.rightName) + ' (Right)</div></div>';
          for (let i = 0; i < filteredNodes.length; i++) {
            const nd = filteredNodes[i];
            html += '<div class="diff-row">';
            if (nd.status === 'added') {
              html += '<div class="diff-cell empty">&mdash;</div>';
              html += renderNodeCell(nd.right, 'added');
            } else if (nd.status === 'removed') {
              html += renderNodeCell(nd.left, 'removed');
              html += '<div class="diff-cell empty">&mdash;</div>';
            } else {
              html += renderNodeCell(nd.left, nd.status);
              let rightHtml = renderNodeCell(nd.right, nd.status);
              if (nd.changes && nd.changes.length > 0) {
                // Append changes to the right cell
                rightHtml = rightHtml.replace('</div><!--end-->', '');
                rightHtml = rightHtml.slice(0, rightHtml.lastIndexOf('</div>'));
                rightHtml += renderChanges(nd.changes) + '</div>';
              }
              html += rightHtml;
            }
            html += '</div>';
          }
          html += '</div>';
        }

        // Edges section
        html += '<h2>Edges</h2>';
        html += renderFilterBar('edge');
        const filteredEdges = diff.edges.filter(function(d) {
          return edgeFilter === 'all' || d.status === edgeFilter;
        });
        if (filteredEdges.length === 0) {
          html += '<div class="no-changes">No edge differences to show.</div>';
        } else {
          html += '<div class="diff-grid">';
          html += '<div class="diff-grid-header"><div>' + esc(diff.leftName) + ' (Left)</div><div>' + esc(diff.rightName) + ' (Right)</div></div>';
          for (let i = 0; i < filteredEdges.length; i++) {
            const ed = filteredEdges[i];
            html += '<div class="diff-row">';
            if (ed.status === 'added') {
              html += '<div class="diff-cell empty">&mdash;</div>';
              html += renderEdgeCell(ed.right, 'added');
            } else if (ed.status === 'removed') {
              html += renderEdgeCell(ed.left, 'removed');
              html += '<div class="diff-cell empty">&mdash;</div>';
            } else {
              html += renderEdgeCell(ed.left, ed.status);
              let rightHtml = renderEdgeCell(ed.right, ed.status);
              if (ed.changes && ed.changes.length > 0) {
                rightHtml = rightHtml.slice(0, rightHtml.lastIndexOf('</div>'));
                rightHtml += renderChanges(ed.changes) + '</div>';
              }
              html += rightHtml;
            }
            html += '</div>';
          }
          html += '</div>';
        }

        app.innerHTML = html;

        // Bind filter buttons
        document.querySelectorAll('.filter-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            const section = btn.getAttribute('data-section');
            const value = btn.getAttribute('data-value');
            if (section === 'node') {
              nodeFilter = value;
            } else {
              edgeFilter = value;
            }
            render();
          });
        });
      }

      function summaryCard(count, label, kind) {
        return '<div class="summary-card">'
          + '<div class="count count-' + kind + '">' + count + '</div>'
          + '<div class="label">' + esc(label) + '</div>'
          + '</div>';
      }

      function renderFilterBar(section) {
        const current = section === 'node' ? nodeFilter : edgeFilter;
        const filters = ['all', 'added', 'removed', 'modified', 'unchanged'];
        let html = '<div class="filter-bar">';
        for (let i = 0; i < filters.length; i++) {
          const f = filters[i];
          const active = f === current ? ' active' : '';
          html += '<button class="filter-btn' + active + '" data-section="' + section + '" data-value="' + f + '">'
            + f.charAt(0).toUpperCase() + f.slice(1)
            + '</button>';
        }
        html += '</div>';
        return html;
      }

      render();
    })();
  </script>
</body>
</html>`;
}

// ── Public command handler ───────────────────────────────────────

let activeDiffPanel: vscode.WebviewPanel | null = null;

export async function openSchematicDiff(extensionUri: vscode.Uri): Promise<void> {
  const left = await pickSchematicFile('Select the LEFT (base) Schematic JSON');
  if (!left) {
    return;
  }

  const right = await pickSchematicFile('Select the RIGHT (changed) Schematic JSON');
  if (!right) {
    return;
  }

  const diff = computeDiff(left, right);

  if (activeDiffPanel) {
    activeDiffPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    activeDiffPanel = vscode.window.createWebviewPanel(
      'ranvierSchematicDiff',
      `Schematic Diff: ${diff.leftName} vs ${diff.rightName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
      }
    );

    activeDiffPanel.onDidDispose(() => {
      activeDiffPanel = null;
    });
  }

  activeDiffPanel.webview.html = getDiffWebviewHtml(
    activeDiffPanel.webview,
    extensionUri,
    diff
  );

  const { summary } = diff;
  const totalChanges =
    summary.nodesAdded + summary.nodesRemoved + summary.nodesModified +
    summary.edgesAdded + summary.edgesRemoved + summary.edgesModified;

  if (totalChanges === 0) {
    vscode.window.showInformationMessage(
      'Schematic Diff: the two schematics are identical.'
    );
  } else {
    vscode.window.showInformationMessage(
      `Schematic Diff: ${totalChanges} change(s) found ` +
      `(+${summary.nodesAdded} -${summary.nodesRemoved} ~${summary.nodesModified} nodes, ` +
      `+${summary.edgesAdded} -${summary.edgesRemoved} ~${summary.edgesModified} edges).`
    );
  }
}

# Ranvier Dev Assist

[한국어 문서](./README.ko.md)

Ranvier Dev Assist is a development-assist extension for Ranvier projects.
It provides circuit visualization, real-time server monitoring, interactive debugging,
and code-level intelligence — all inside VS Code.

- Publisher: `cellaxon`
- Extension ID: `cellaxon.ranvier-vscode`
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cellaxon.ranvier-vscode) · [Open VSX](https://open-vsx.org/extension/cellaxon/ranvier-vscode)
- Repository: [github.com/ranvier-rs/vscode](https://github.com/ranvier-rs/vscode)

## Features

### Circuit Visualization

- Interactive flow graph powered by SvelteFlow (`@xyflow/svelte`)
- Pan, zoom, minimap, drag-to-reposition nodes
- Node positions auto-saved back to Rust source (`#[transition(x, y)]`)
- Active editor file highlights mapped nodes in the circuit

### Source Navigation

- **Node → Source**: click a node to jump to its `source_location` file and line
- **Source → Node**: `Reveal Circuit Node From Current Line` focuses the circuit on the nearest node
- **Issue traversal**: `Next / Previous Node Issue` shortcuts cycle through nodes with diagnostics

### Diagnostics

- Reads `diagnostics.json` and overlays severity badges (error / warning / info) on nodes
- Projects mapped diagnostics into the standard VS Code **Problems** panel
- Sidebar shows per-node summary with hover tooltips

### Real-Time Server Monitoring

Connects to the Ranvier Inspector server via WebSocket for live metrics.

- **4-mode heatmap overlay** on circuit nodes:
  - **Traffic** — throughput per second (green → yellow → red)
  - **Latency** — p95 response time in ms
  - **Errors** — error rate percentage
  - **None** — disabled (default)
- **Node badges** show metric values (e.g. `25/s`, `p95:450ms`, `15%err`)
- **Edge styling** responds to throughput and error rate
- Configurable server URL (`ranvier.debugger.inspectorUrl`) and poll interval (`ranvier.server.pollInterval`)

### Event Stream Panel

Real-time event log from Inspector with filtering capabilities.

- Captures `node_enter`, `node_exit`, `circuit_exit` events (up to 200)
- Filter by node ID, event type, or free-text search
- Color-coded event types and fault highlighting
- Timestamp display (HH:MM:SS.mmm)

### Stall Detection

- Inspector detects nodes exceeding a configurable time threshold (default 30s)
- Stalled nodes display a **pulsing red glow** and `[STALL]` badge in the circuit
- Server-side configuration: `RANVIER_INSPECTOR_STALL_THRESHOLD_MS`

### Debug Controls

Interactive breakpoint debugging for paused executions.

- **Resume** / **Step** buttons appear in the toolbar when execution pauses at a breakpoint
- Status bar shows paused node and trace ID
- Paused nodes are visually highlighted in the circuit

### Template Toolbox

Sidebar panel with curated code snippets organized by category.

- **Click** to insert snippet at cursor position
- **Drag** onto canvas to add a new transition node
- Categories: Transitions, Pipelines, Bus & Resources, Error Handling, Resilience
- Built-in learning paths: Quick Start, HTTP Services, Advanced Patterns

### Code Snippets

6 Rust snippets for common Ranvier patterns:

| Prefix | Description |
|--------|-------------|
| `rvtransition` | `#[transition]` macro-based transition |
| `rv-transition` | Manual `Transition` trait impl |
| `rvroute` | `#[route(METHOD, "/path")]` HTTP route |
| `rvaxon` | Axon builder chain with `.then()` and `.execute()` |
| `rvbus` | Bus resource insert/get pattern |
| `rvtest` | Transition unit test boilerplate |

### Example Commands

- **Ranvier: Load Example Schematic** (`ranvier.loadExampleSchematic`) — Browse examples with prebuilt schematics and open them in the Circuit View
- **Ranvier: Run Example** (`ranvier.runExample`) — Pick any example from `catalog.json` and run it in the integrated terminal via `cargo run -p <example>`

### Code Intelligence (Rust)

- **Completions**: Axon method suggestions (`.then()`, `.retry()`, `.checkpoint()`, …) and transition names from schematic
- **Hover**: node metadata, source location, and diagnostics summary on hover

### Project Discovery

- Auto-detects Ranvier projects in monorepos (scans `Cargo.toml` / `package.json`)
- Per-workspace project target selection with cache
- Sidebar dropdown for switching between projects

## Quick Demo

Node click → source jump:

![Node click to source jump demo](./media/demo-node-jump.gif)

## Setup

### 1) Add Ranvier dependencies

```bash
cargo add ranvier
cargo add tokio --features full
cargo add anyhow
```

### 2) Install Ranvier CLI and generate schematic

```bash
cargo install ranvier-cli
ranvier schematic basic-schematic --output schematic.json
```

The extension reads:

1. `<workspace-root>/schematic.json`
2. `<workspace-root>/diagnostics.json` (optional)

### 3) Use in VS Code

1. Command Palette → `Ranvier: Open Circuit View`
2. Open the **Ranvier Circuit Nodes** sidebar
3. Click a node to jump to source
4. Use `Run Schematic Export` to regenerate `schematic.json`
5. Use `Refresh Diagnostics` to reload diagnostics overlay
6. Toggle **Heatmap** button in the toolbar to switch monitoring modes

### 4) Connect to Inspector server (optional)

Start the Ranvier Inspector server, then the extension auto-connects:

- Default URL: `http://localhost:3000` (configurable via `ranvier.debugger.inspectorUrl`)
- Metrics, events, stall alerts, and debug controls activate automatically
- If the server is not running, the extension falls back to static `schematic.json`

## Commands

| Command | ID | Shortcut |
|---|---|---|
| Open Circuit View | `ranvier.openCircuitView` | |
| Refresh Circuit Data | `ranvier.refreshCircuitData` | |
| Run Schematic Export | `ranvier.exportSchematic` | |
| Reveal Node Source | `ranvier.revealNodeSource` | |
| Refresh Diagnostics | `ranvier.refreshDiagnostics` | |
| Reveal Circuit Node From Current Line | `ranvier.revealNodeFromCurrentLine` | |
| Go To Next Node Issue | `ranvier.nextNodeIssue` | `Ctrl+Alt+N` |
| Go To Previous Node Issue | `ranvier.previousNodeIssue` | `Ctrl+Alt+P` |

macOS: `Cmd+Alt+N` / `Cmd+Alt+P`

## Configuration

| Key | Default | Description |
|---|---|---|
| `ranvier.schematicExport.example` | `basic-schematic` | CLI example name for schematic export |
| `ranvier.schematicExport.outputPath` | `schematic.json` | Output path for exported schematic |
| `ranvier.diagnostics.inputPath` | `diagnostics.json` | Path to diagnostics input file |
| `ranvier.debugger.inspectorUrl` | `http://localhost:3000` | Inspector server URL |
| `ranvier.server.pollInterval` | `10` | Server health poll interval in seconds (2–300) |

## Diagnostics Input Format

Example `diagnostics.json`:

```json
{
  "diagnostics": [
    {
      "node_id": "inspect",
      "severity": "error",
      "message": "Inspector path timeout",
      "source": "runtime"
    }
  ]
}
```

Required fields: `node_id` (or `nodeId`), `severity`, `message`, `source`

## Input Compatibility

Supported source mapping fields:

- `source_location` / `sourceLocation`
- `metadata.source_location` / `metadata.sourceLocation`

Supported edge endpoint fields:

- `source` / `target`
- `from` / `to`

## Shortcut Conflict FAQ

**Q: `Ctrl+Alt+N/P` does not work.**
A: Check conflicts in VS Code Keyboard Shortcuts, then override in `keybindings.json`.

**Q: Vim extension captures the shortcut first.**
A: Use `Ctrl+Shift+Alt+N/P` with `when: "editorTextFocus && !editorReadonly"`.

**Q: JetBrains keymap conflict.**
A: Remap Ranvier commands to an unused pair.

**Q: macOS global shortcut conflict.**
A: Rebind to `Cmd+Shift+Alt+N/P` in `keybindings.json`.

Profile templates available: `keybindings.recommended.json`, `keybindings.vim.json`, `keybindings.jetbrains.json`, `keybindings.mac.json`

## Release / Operations

Full guide: [`docs/03_guides/vscode_extension_deploy.md`](../docs/03_guides/vscode_extension_deploy.md)

| # | Section | Use Case |
|---|---------|----------|
| 2 | [Local Build Checks](../docs/03_guides/vscode_extension_deploy.md#2-local-build-checks) | Pre-publish build/typecheck/package verification |
| 8 | [Keyboard Shortcuts (Team Override)](../docs/03_guides/vscode_extension_deploy.md#8-keyboard-shortcuts-team-override) | Override default shortcuts when conflicts exist |
| 10 | [Conflict Matrix](../docs/03_guides/vscode_extension_deploy.md#10-conflict-matrix-quick-reference) | Vim/JetBrains/macOS collision lookup |
| 14 | [Release Checklist Template](../docs/03_guides/vscode_extension_deploy.md#14-release-checklist-template) | Step-by-step release checklist |

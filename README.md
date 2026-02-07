# Ranvier Dev Assist

[한국어 문서](./README.ko.md)

Ranvier Dev Assist is a development-assist extension for Ranvier projects.
It helps you validate circuit structure before runtime, navigate source quickly,
and review node-linked diagnostics in the IDE loop.

- Publisher: `cellaxon`
- Extension ID: `cellaxon.ranvier-vscode`
- Marketplace: `https://marketplace.visualstudio.com/manage/publishers/cellaxon`

## What It Does

1. Visualizes circuits from `schematic.json`
2. Node click/select -> source jump (`source_location`)
3. Highlights nodes mapped to the active editor file
4. Provides a sidebar panel (`Ranvier Circuit Nodes`) for structure navigation
5. Runs `Run Schematic Export` from the extension UI
6. Shows node-level diagnostics overlays from `diagnostics.json` (webview + sidebar)

## Quick Demo

Node click -> source jump:

![Node click to source jump demo](./media/demo-node-jump.gif)

## Setup for a Ranvier Project

### 1) Add Ranvier dependencies

```bash
cargo add ranvier
cargo add tokio --features full
cargo add anyhow
```

### 2) Generate schematic

From workspace root (or using your CLI manifest path):

```bash
cargo run --manifest-path cli/Cargo.toml -- schematic basic-schematic --output schematic.json
```

The extension reads:

1. `<workspace-root>/schematic.json`
2. `<workspace-root>/diagnostics.json` (optional)

### 3) Use in VSCode

1. Command Palette -> `Ranvier: Open Circuit View`
2. Open `Ranvier Circuit Nodes` in the Ranvier sidebar
3. Click a node (webview/panel) to jump to source
4. Use `Run Schematic Export` to refresh `schematic.json`
5. Use `Refresh Diagnostics` to refresh diagnostics overlay
6. Use `Ranvier: Refresh Circuit Data` for manual full refresh

### 4) Diagnostics input format (optional)

Example `diagnostics.json`:

```json
{
  "diagnostics": [
    {
      "node_id": "inspect",
      "severity": "error",
      "message": "Inspector path timeout",
      "source": "runtime"
    },
    {
      "node_id": "ingress",
      "severity": "warning",
      "message": "Slow branch selected",
      "source": "lint"
    }
  ]
}
```

Required fields:

1. `node_id` (or `nodeId`)
2. `severity` (`error`, `warning`, `info`)
3. `message`
4. `source`

Settings:

1. `ranvier.diagnostics.inputPath` (default: `diagnostics.json`)

## Recommended Team Loop (Before PR)

1. Regenerate `schematic.json` when Ranvier flow changes
2. Verify node/edge changes in circuit view
3. Confirm source-jump for changed key nodes
4. Confirm active-file highlight matches expected nodes
5. Record circuit impact summary in PR when needed

## Commands

1. `Ranvier: Open Circuit View`
2. `Ranvier: Refresh Circuit Data`
3. `Ranvier: Run Schematic Export`
4. `Ranvier: Reveal Node Source`
5. `Ranvier: Refresh Diagnostics`

## Input Compatibility

Supported source mapping fields:

1. `source_location`
2. `sourceLocation`
3. `metadata.source_location`
4. `metadata.sourceLocation`

Supported edge endpoint fields:

1. `source` / `target`
2. `from` / `to`

## Release/Operations Reference

1. `docs/03_guides/vscode_extension_deploy.md`

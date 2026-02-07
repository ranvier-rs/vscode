# Ranvier Dev Assist

Ranvier Dev Assist is a VSCode extension for development-time circuit understanding:

1. Visualize circuit structure from `schematic.json`
2. Jump from node to source code (`source_location`)
3. Track current file context with node highlight

- Publisher: `cellaxon`
- Extension ID: `cellaxon.ranvier-vscode`
- Marketplace: `https://marketplace.visualstudio.com/manage/publishers/cellaxon`

## Features

1. Circuit View (Svelte + `@xyflow/svelte`) in webview.
2. Explorer panel: `Ranvier Circuit Nodes`.
3. Node click/selection to source jump.
4. Active editor file to node highlight sync.
5. Safe feedback for unmapped nodes (no silent no-op).

## Commands

1. `Ranvier: Open Circuit View`
2. `Ranvier: Refresh Circuit Data`
3. `Ranvier: Reveal Node Source`

## Data Contract

Default input file:

1. `<workspace-root>/schematic.json`

Supported field variants:

1. Node source mapping: `source_location`, `sourceLocation`, `metadata.source_location`, `metadata.sourceLocation`
2. Edge endpoints: `source/target` and `from/to`

## Development

```bash
npm install
npm run typecheck
npm run build
```

## Package & Publish

```bash
npm run package
npm run publish:marketplace
```

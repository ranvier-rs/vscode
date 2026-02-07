# Changelog

## 0.0.2

- Added extension icon from shared web favicon asset (`media/favicon.png`).
- Added Explorer view (`Ranvier Circuit Nodes`) and refresh command.
- Added `Ranvier: Run Schematic Export` command and webview toolbar button.
- Added active editor file to node highlight sync in circuit webview.
- Improved `schematic.json` parsing compatibility for edge/source-location field variants.
- Added parser/source-resolution regression tests (`npm test`).
- Updated README with extension-focused feature/command/data-contract documentation.

## 0.0.1

- Initial extension scaffold with:
  - VSCode command: `Ranvier: Open Circuit View`
  - Webview built with Svelte + `@xyflow/svelte`
  - Node click -> source jump baseline

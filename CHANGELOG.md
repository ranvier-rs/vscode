# Changelog

## Unreleased

## 0.0.4

- Reworked sidebar to `WebviewView` and split UI into:
  - `Quick Actions` section (refresh/export/diagnostics)
  - `Circuit Nodes` section (focused node highlight + source jump)
- Removed crowded title-bar text actions for `Ranvier Circuit Nodes`.
- Improved workspace root resolution to prefer active project context in multi-root setups.
- Added schematic export fallback behavior:
  - use configured Cargo manifest when available
  - fallback to installed `ranvier` CLI when manifest path is missing

## 0.0.3

- Added diagnostics overlay baseline (`diagnostics.json`) in webview and explorer node list.
- Added `Ranvier: Refresh Diagnostics` command and webview refresh button.
- Added release hardening utilities:
  - `npm run release:verify` (version/changelog/VSIX consistency)
  - CI package smoke workflow (`vscode-package-smoke`)
- Added extension localization baseline:
  - `package.nls.json` + `package.nls.ko.json` for commands/views/settings metadata
  - English default README + Korean README split (`README.md`, `README.ko.md`)
  - webview UI locale dictionary (`en`, `ko`) with fallback to English
- Added Problems panel linkage baseline:
  - mapped node diagnostics are projected to VSCode Problems via `DiagnosticCollection`
  - projection core module + unit test (`src/core/problems.ts`, `src/core/problems.test.ts`)
- Added editor-line to circuit focus command:
  - `Ranvier: Reveal Circuit Node From Current Line`
  - webview supports node-focus highlight message (`highlight-node`)
- Added performance baseline hardening:
  - debounced editor context sync and duplicate highlight suppression
  - animation-frame batched node rebuild in webview
  - large-schematic perf smoke command (`npm run perf:schematic`)

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

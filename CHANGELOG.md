# Changelog

## Unreleased

## 0.0.6

- Updated Template Toolbox to v0.17 API patterns:
  - 5 categories (Transitions, Pipelines, Bus & Resources, Error Handling, Resilience) with 15 templates
  - 3 Learning Paths (Quick Start, HTTP Services, Advanced Patterns)
- Added live step-through debugging and context-aware IntelliSense
- Added bi-directional schematic builder with layout sync (M171)
- Added M170-M173 delivery: distributed execution, enterprise DX, workflow versioning, operational resilience
- Added post-publish evidence automation:
  - `scripts/ci-post-publish-evidence.mjs` for automated install/command smoke + docs sync verification
  - `npm run ci:post-publish` script

## 0.0.5

- Reworked target project UX for multi-project workspaces:
  - workspace scan + cached project discovery
  - explicit target selection and rescan actions
  - last scan timestamp and clearer target status
- Replaced native select popup with a custom in-webview project picker to avoid OS-level styling inconsistencies.
- Refined sidebar layout:
  - reduced horizontal/vertical padding for narrow sidebars
  - responsive component expansion under constrained width
  - fixed dropdown panel overlap/section title clipping issues
- Updated schematic export behavior:
  - better error messaging for invalid-directory (`os error 267`) scenarios
  - automatic example suggestion from selected target project when user setting is not explicitly overridden
  - improved startup guidance when `ranvier` CLI is missing from PATH

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

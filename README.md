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
7. Projects mapped node diagnostics into VSCode Problems panel

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

### 2) Install Ranvier CLI and generate schematic

Install Ranvier CLI once:

```bash
cargo install ranvier-cli
```

Then run from workspace root:

```bash
ranvier schematic basic-schematic --output schematic.json
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
7. Review file-level diagnostics in the Problems panel (`source: ranvier:*`)
8. Use `Ranvier: Reveal Circuit Node From Current Line` to jump back from editor line to circuit focus
9. Use `Ranvier: Go To Next Node Issue` / `Ranvier: Go To Previous Node Issue` to navigate node-linked issues
10. Default shortcuts: `Ctrl+Alt+N` / `Ctrl+Alt+P` (macOS: `Cmd+Alt+N` / `Cmd+Alt+P`)
11. If shortcuts conflict, override keys in VSCode `keybindings.json` (see deploy guide [Keyboard Shortcuts (Team Override)](../docs/03_guides/vscode_extension_deploy.md#8-keyboard-shortcuts-team-override)).
12. Team template file: `vscode/.vscode/keybindings.recommended.json` (copy to your user `keybindings.json`).
13. Optional profile templates: `keybindings.vim.json`, `keybindings.jetbrains.json`, `keybindings.mac.json`.

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
6. `Ranvier: Reveal Circuit Node From Current Line`
7. `Ranvier: Go To Next Node Issue`
8. `Ranvier: Go To Previous Node Issue`

## Shortcut Conflict FAQ

### General Conflict

1. Q: `Ctrl+Alt+N/P` does not work on my setup.
A: Open VSCode Keyboard Shortcuts and check conflicts, then override in `keybindings.json` using the team snippet from deploy guide.

### Vim Conflict

2. Q: Vim extension consumes the shortcut first.
A: Use a different chord (for example `Ctrl+Shift+Alt+N/P`) and keep `when: "editorTextFocus && !editorReadonly"`.

### JetBrains Keymap Conflict

3. Q: JetBrains keymap extension already uses a similar binding.
A: Remap Ranvier commands to an unused pair and document the team standard in your workspace guide.

### macOS Global Shortcut Conflict

4. Q: macOS global shortcut conflicts with `Cmd+Alt+N/P`.
A: Rebind to another combo (for example `Cmd+Shift+Alt+N/P`) in VSCode `keybindings.json`.

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

Full guide: [`docs/03_guides/vscode_extension_deploy.md`](../docs/03_guides/vscode_extension_deploy.md)

Key sections:

| # | Section | Use Case |
|---|---------|----------|
| 2 | [Local Build Checks](../docs/03_guides/vscode_extension_deploy.md#2-local-build-checks) | Pre-publish build/typecheck/package verification |
| 8 | [Keyboard Shortcuts (Team Override)](../docs/03_guides/vscode_extension_deploy.md#8-keyboard-shortcuts-team-override) | Override default shortcuts when conflicts exist |
| 10 | [Conflict Matrix](../docs/03_guides/vscode_extension_deploy.md#10-conflict-matrix-quick-reference) | Vim/JetBrains/macOS collision lookup |
| 12 | [Profile Template Open Commands](../docs/03_guides/vscode_extension_deploy.md#12-profile-template-open-commands-os-variants) | OS-specific file open commands |
| 13 | [Command Name Localization](../docs/03_guides/vscode_extension_deploy.md#13-command-name-localization-note-enko) | EN/KO command name mapping |
| 14 | [Release Checklist Template](../docs/03_guides/vscode_extension_deploy.md#14-release-checklist-template) | Step-by-step release checklist |

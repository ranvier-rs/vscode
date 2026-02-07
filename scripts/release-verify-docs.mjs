import fs from 'node:fs';
import path from 'node:path';

const vscodeRoot = process.cwd();
const workspaceRoot = path.resolve(vscodeRoot, '..');

const packageJson = readJson(path.join(vscodeRoot, 'package.json'));
const extensionVersion = packageJson.version;
if (!extensionVersion || typeof extensionVersion !== 'string') {
  fail('Invalid vscode/package.json version.');
}

const registryJsonPath = path.join(
  workspaceRoot,
  'docs',
  '05_dev_plans',
  'CAPABILITY_REGISTRY.json'
);
const registryMdPath = path.join(
  workspaceRoot,
  'docs',
  '05_dev_plans',
  'CAPABILITY_REGISTRY.md'
);
const deployGuidePath = path.join(
  workspaceRoot,
  'docs',
  '03_guides',
  'vscode_extension_deploy.md'
);
const readmePath = path.join(vscodeRoot, 'README.md');
const readmeKoPath = path.join(vscodeRoot, 'README.ko.md');
const keybindingTemplatePath = path.join(vscodeRoot, '.vscode', 'keybindings.recommended.json');
const keybindingVimTemplatePath = path.join(vscodeRoot, '.vscode', 'keybindings.vim.json');
const keybindingJetbrainsTemplatePath = path.join(vscodeRoot, '.vscode', 'keybindings.jetbrains.json');
const keybindingMacTemplatePath = path.join(vscodeRoot, '.vscode', 'keybindings.mac.json');

const registry = readJson(registryJsonPath);
const vscodeModule = (registry.modules ?? []).find((item) => item.module === 'vscode');
if (!vscodeModule) {
  fail('CAPABILITY_REGISTRY.json is missing "vscode" module.');
}

const moduleVersion = vscodeModule?.versioning?.current;
if (moduleVersion !== extensionVersion) {
  fail(
    `Version mismatch: package.json=${extensionVersion}, CAPABILITY_REGISTRY.json(vscode.versioning.current)=${moduleVersion}`
  );
}

const vscodeArtifact = (vscodeModule?.versioning?.artifacts ?? []).find(
  (artifact) =>
    artifact.name === 'ranvier-vscode' && artifact.ecosystem === 'vscode-marketplace'
);
if (!vscodeArtifact) {
  fail('Missing vscode-marketplace artifact for ranvier-vscode in CAPABILITY_REGISTRY.json.');
}
if (vscodeArtifact.version !== extensionVersion) {
  fail(
    `Artifact version mismatch: package.json=${extensionVersion}, artifact.version=${vscodeArtifact.version}`
  );
}

const registryMd = readText(registryMdPath);
const registryVersionLine = registryMd.match(/\*\*Version:\*\*\s+([0-9]+\.[0-9]+\.[0-9]+)/);
if (!registryVersionLine) {
  fail('Could not find **Version:** line in CAPABILITY_REGISTRY.md.');
}
if (registryVersionLine[1] !== registry.version) {
  fail(
    `Registry version mismatch: CAPABILITY_REGISTRY.json=${registry.version}, CAPABILITY_REGISTRY.md=${registryVersionLine[1]}`
  );
}

const deployGuide = readText(deployGuidePath);
if (!deployGuide.includes('npm run release:verify:docs')) {
  fail('Deploy guide is missing "npm run release:verify:docs" command.');
}
if (!deployGuide.includes('Marketplace publish is manual-only (no CI publish).')) {
  fail('Deploy guide is missing manual-only Marketplace publish policy line.');
}
if (!deployGuide.includes('## 8. Keyboard Shortcuts (Team Override)')) {
  fail('Deploy guide is missing keyboard shortcut override section.');
}
if (!deployGuide.includes('"command": "ranvier.nextNodeIssue"')) {
  fail('Deploy guide is missing keybinding override snippet for next node issue command.');
}
if (!deployGuide.includes('vscode/.vscode/keybindings.recommended.json')) {
  fail('Deploy guide is missing reference to workspace keybinding template file.');
}
if (!deployGuide.includes('vscode/.vscode/keybindings.vim.json')) {
  fail('Deploy guide is missing reference to vim keybinding template file.');
}
if (!deployGuide.includes('vscode/.vscode/keybindings.jetbrains.json')) {
  fail('Deploy guide is missing reference to jetbrains keybinding template file.');
}
if (!deployGuide.includes('vscode/.vscode/keybindings.mac.json')) {
  fail('Deploy guide is missing reference to mac keybinding template file.');
}
if (!deployGuide.includes("vim.mode != 'Insert'")) {
  fail('Deploy guide is missing vim profile recommendation note.');
}
if (!deployGuide.includes('Ctrl+Alt+[') || !deployGuide.includes('Ctrl+Alt+]')) {
  fail('Deploy guide is missing jetbrains profile recommendation note.');
}
if (!deployGuide.includes('Cmd+Shift+Alt+N/P')) {
  fail('Deploy guide is missing mac profile recommendation note.');
}
if (!deployGuide.includes('## 10. Conflict Matrix (Quick Reference)')) {
  fail('Deploy guide is missing quick conflict matrix section.');
}
if (!deployGuide.includes('| Profile | Likely Collision | Suggested Override | Template |')) {
  fail('Deploy guide is missing conflict matrix table header.');
}
if (!deployGuide.includes('| `vim` |') || !deployGuide.includes('| `jetbrains` |') || !deployGuide.includes('| `mac` |')) {
  fail('Deploy guide conflict matrix is missing one or more profile rows.');
}
if (!deployGuide.includes('../../vscode/.vscode/keybindings.vim.json')) {
  fail('Deploy guide conflict matrix is missing vim template link.');
}
if (!deployGuide.includes('../../vscode/.vscode/keybindings.jetbrains.json')) {
  fail('Deploy guide conflict matrix is missing jetbrains template link.');
}
if (!deployGuide.includes('../../vscode/.vscode/keybindings.mac.json')) {
  fail('Deploy guide conflict matrix is missing mac template link.');
}
if (!deployGuide.includes('## 11. Profile Template Open Commands')) {
  fail('Deploy guide is missing profile template open commands section.');
}
if (!deployGuide.includes('code vscode/.vscode/keybindings.vim.json')) {
  fail('Deploy guide is missing open command for vim keybinding template.');
}
if (!deployGuide.includes('code vscode/.vscode/keybindings.jetbrains.json')) {
  fail('Deploy guide is missing open command for jetbrains keybinding template.');
}
if (!deployGuide.includes('code vscode/.vscode/keybindings.mac.json')) {
  fail('Deploy guide is missing open command for mac keybinding template.');
}
if (!deployGuide.includes('## 12. Profile Template Open Commands (OS Variants)')) {
  fail('Deploy guide is missing OS-variant profile template open commands section.');
}
if (!deployGuide.includes('code .\\vscode\\.vscode\\keybindings.vim.json')) {
  fail('Deploy guide is missing PowerShell open command for vim keybinding template.');
}
if (!deployGuide.includes('code .\\vscode\\.vscode\\keybindings.jetbrains.json')) {
  fail('Deploy guide is missing PowerShell open command for jetbrains keybinding template.');
}
if (!deployGuide.includes('code .\\vscode\\.vscode\\keybindings.mac.json')) {
  fail('Deploy guide is missing PowerShell open command for mac keybinding template.');
}
if (!deployGuide.includes('code ./vscode/.vscode/keybindings.vim.json')) {
  fail('Deploy guide is missing macOS terminal open command for vim keybinding template.');
}
if (!deployGuide.includes('code ./vscode/.vscode/keybindings.jetbrains.json')) {
  fail('Deploy guide is missing macOS terminal open command for jetbrains keybinding template.');
}
if (!deployGuide.includes('code ./vscode/.vscode/keybindings.mac.json')) {
  fail('Deploy guide is missing macOS terminal open command for mac keybinding template.');
}
if (!deployGuide.includes('code-insiders .\\vscode\\.vscode\\keybindings.vim.json')) {
  fail('Deploy guide is missing PowerShell code-insiders fallback command example.');
}
if (!deployGuide.includes('code-insiders .\\vscode\\.vscode\\keybindings.jetbrains.json')) {
  fail('Deploy guide is missing PowerShell code-insiders fallback for jetbrains template.');
}
if (!deployGuide.includes('code-insiders .\\vscode\\.vscode\\keybindings.mac.json')) {
  fail('Deploy guide is missing PowerShell code-insiders fallback for mac template.');
}
if (!deployGuide.includes('code-insiders ./vscode/.vscode/keybindings.vim.json')) {
  fail('Deploy guide is missing macOS/Linux code-insiders fallback for vim template.');
}
if (!deployGuide.includes('code-insiders ./vscode/.vscode/keybindings.jetbrains.json')) {
  fail('Deploy guide is missing macOS/Linux code-insiders fallback for jetbrains template.');
}
if (!deployGuide.includes('code-insiders ./vscode/.vscode/keybindings.mac.json')) {
  fail('Deploy guide is missing macOS/Linux code-insiders fallback for mac template.');
}
if (!deployGuide.includes('Insiders fallback (Compact Copy Block):')) {
  fail('Deploy guide is missing compact copy block section for code-insiders fallback.');
}
if (!deployGuide.includes('Linux (Bash/Zsh):')) {
  fail('Deploy guide is missing Linux shell variant subsection for profile template open commands.');
}
if (
  !deployGuide.includes(
    'compatible with `bash`, `zsh`, and `fish` when the `code` CLI is available in `PATH`'
  )
) {
  fail('Deploy guide is missing shell-family compatibility note for Linux open-command snippet.');
}
if (!deployGuide.includes('`code` CLI PATH troubleshooting:')) {
  fail('Deploy guide is missing code CLI PATH troubleshooting section.');
}
if (!deployGuide.includes('Get-Command code')) {
  fail('Deploy guide is missing Windows PowerShell PATH troubleshooting command.');
}
if (!deployGuide.includes('which code')) {
  fail('Deploy guide is missing macOS/Linux PATH troubleshooting command.');
}
if (!deployGuide.includes("Shell Command: Install 'code' command in PATH")) {
  fail('Deploy guide is missing VSCode command palette PATH fix guidance.');
}
if (!deployGuide.includes('VSCode Remote / Dev Container:')) {
  fail('Deploy guide is missing VSCode Remote/Dev Container PATH behavior note.');
}
if (
  !deployGuide.includes(
    'host and container sessions; verify `code --version` in the active session first.'
  )
) {
  fail('Deploy guide is missing host/container code CLI resolution note for remote sessions.');
}
if (!deployGuide.includes('VSCode Insiders fallback:')) {
  fail('Deploy guide is missing VSCode Insiders fallback subsection.');
}
if (!deployGuide.includes('code-insiders --version')) {
  fail('Deploy guide is missing code-insiders fallback validation command.');
}
if (!deployGuide.includes('Replace `code` commands in this guide with `code-insiders`')) {
  fail('Deploy guide is missing code-insiders command replacement guidance.');
}
if (!deployGuide.includes('CLI variant quick matrix:')) {
  fail('Deploy guide is missing CLI variant quick matrix section.');
}
if (!deployGuide.includes('| Scenario | CLI |')) {
  fail('Deploy guide is missing CLI variant quick matrix header.');
}
if (
  !deployGuide.includes('| VSCode Stable default | `code` |') ||
  !deployGuide.includes('| VSCode Insiders default | `code-insiders` |') ||
  !deployGuide.includes('| Stable unavailable but Insiders installed | `code-insiders` |')
) {
  fail('Deploy guide CLI variant quick matrix is missing one or more required rows.');
}
if (!deployGuide.includes('../../vscode/README.md#vim-conflict')) {
  fail('Deploy guide conflict matrix is missing EN FAQ anchor link for vim row.');
}
if (!deployGuide.includes('../../vscode/README.md#jetbrains-keymap-conflict')) {
  fail('Deploy guide conflict matrix is missing EN FAQ anchor link for jetbrains row.');
}
if (!deployGuide.includes('../../vscode/README.md#macos-global-shortcut-conflict')) {
  fail('Deploy guide conflict matrix is missing EN FAQ anchor link for mac row.');
}

const readme = readText(readmePath);
if (!readme.includes('## Shortcut Conflict FAQ')) {
  fail('README.md is missing Shortcut Conflict FAQ section.');
}
if (!readme.includes('Vim extension consumes the shortcut first.')) {
  fail('README.md is missing Vim shortcut conflict FAQ item.');
}
if (!readme.includes('### Vim Conflict')) {
  fail('README.md is missing Vim Conflict anchor heading.');
}
if (!readme.includes('### JetBrains Keymap Conflict')) {
  fail('README.md is missing JetBrains Keymap Conflict anchor heading.');
}
if (!readme.includes('### macOS Global Shortcut Conflict')) {
  fail('README.md is missing macOS Global Shortcut Conflict anchor heading.');
}

const readmeKo = readText(readmeKoPath);
if (!readmeKo.includes('## 단축키 충돌 FAQ')) {
  fail('README.ko.md is missing shortcut conflict FAQ section.');
}
if (!readmeKo.includes('Vim 확장이 먼저 단축키를 가져갑니다.')) {
  fail('README.ko.md is missing Vim shortcut conflict FAQ item.');
}
if (!readmeKo.includes('### Vim 충돌')) {
  fail('README.ko.md is missing Vim conflict anchor heading.');
}
if (!readmeKo.includes('### JetBrains 키맵 충돌')) {
  fail('README.ko.md is missing JetBrains keymap conflict anchor heading.');
}
if (!readmeKo.includes('### macOS 글로벌 단축키 충돌')) {
  fail('README.ko.md is missing macOS global shortcut conflict anchor heading.');
}

const keybindingTemplate = readJson(keybindingTemplatePath);
assertKeybindingTemplate(keybindingTemplate, 'recommended');
assertKeybindingTemplate(readJson(keybindingVimTemplatePath), 'vim');
assertKeybindingTemplate(readJson(keybindingJetbrainsTemplatePath), 'jetbrains');
assertKeybindingTemplate(readJson(keybindingMacTemplatePath), 'mac');

console.log(`Release docs verify passed for vscode version ${extensionVersion}.`);
console.log(`- CAPABILITY_REGISTRY.json vscode.versioning.current: ${moduleVersion}`);
console.log(`- vscode-marketplace artifact version: ${vscodeArtifact.version}`);
console.log(`- CAPABILITY_REGISTRY.md version: ${registryVersionLine[1]}`);
console.log('- deploy guide contains release:verify:docs command');
console.log('- deploy guide contains manual-only Marketplace publish policy');
console.log('- deploy guide contains keyboard shortcut override section');
console.log('- deploy guide contains vim/jetbrains/mac profile recommendation notes');
console.log('- deploy guide contains quick conflict matrix table');
console.log('- deploy guide conflict matrix contains FAQ anchor links');
console.log('- deploy guide conflict matrix contains template file links');
console.log('- deploy guide contains copy-ready profile template open commands');
console.log('- deploy guide contains OS-variant profile template open commands');
console.log('- deploy guide contains Linux shell variant profile template open commands');
console.log('- deploy guide contains shell-family compatibility note for Linux open-command snippet');
console.log('- deploy guide contains one-line code-insiders fallback command examples for vim/jetbrains/mac');
console.log('- deploy guide contains compact copy block for code-insiders fallback commands');
console.log('- deploy guide contains code CLI PATH troubleshooting guidance');
console.log('- deploy guide contains VSCode Remote/Dev Container code CLI behavior note');
console.log('- deploy guide contains VSCode Insiders code-insiders fallback note');
console.log('- deploy guide contains CLI variant quick matrix for code/code-insiders');
console.log('- README(EN/KO) contains shortcut conflict FAQ section');
console.log('- workspace keybinding template exists with next/previous node issue bindings');
console.log('- profile keybinding templates (vim/jetbrains/mac) exist with next/previous node issue bindings');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function fail(message) {
  console.error(`Release docs verify failed: ${message}`);
  process.exit(1);
}

function assertKeybindingTemplate(template, templateName) {
  if (!Array.isArray(template) || template.length === 0) {
    fail(`Keybinding template (${templateName}) must be a non-empty array.`);
  }
  const hasNextIssueBinding = template.some((entry) => entry?.command === 'ranvier.nextNodeIssue');
  if (!hasNextIssueBinding) {
    fail(`Keybinding template (${templateName}) is missing ranvier.nextNodeIssue binding.`);
  }
  const hasPreviousIssueBinding = template.some(
    (entry) => entry?.command === 'ranvier.previousNodeIssue'
  );
  if (!hasPreviousIssueBinding) {
    fail(`Keybinding template (${templateName}) is missing ranvier.previousNodeIssue binding.`);
  }
}

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'changelog.md');

if (!fs.existsSync(packageJsonPath)) {
  fail('package.json not found in current directory.');
}

if (!fs.existsSync(changelogPath)) {
  fail('changelog.md not found in current directory.');
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
if (!version || typeof version !== 'string') {
  fail('Invalid version field in package.json.');
}

const changelog = fs.readFileSync(changelogPath, 'utf8');
const heading = `## ${version}`;
if (!changelog.includes(heading)) {
  fail(`Missing changelog heading "${heading}".`);
}

const expectedVsix = path.join(root, `ranvier-vscode-${version}.vsix`);
if (!fs.existsSync(expectedVsix)) {
  fail(`Missing VSIX artifact: ${path.basename(expectedVsix)}. Run "npm run package" first.`);
}

const stats = fs.statSync(expectedVsix);
if (stats.size <= 0) {
  fail(`VSIX artifact is empty: ${path.basename(expectedVsix)}.`);
}

console.log(`Release verify passed for version ${version}.`);
console.log(`- changelog heading found: ${heading}`);
console.log(`- vsix found: ${path.basename(expectedVsix)} (${stats.size} bytes)`);

function fail(message) {
  console.error(`Release verify failed: ${message}`);
  process.exit(1);
}

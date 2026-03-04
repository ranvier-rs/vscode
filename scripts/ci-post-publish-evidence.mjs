/**
 * ci-post-publish-evidence.mjs
 *
 * Post-publish verification script for the Ranvier VSCode extension.
 * Runs release-verify and release-verify-docs, checks the VSIX artifact,
 * and writes a structured evidence JSON file to dist/.
 *
 * Usage: node ./scripts/ci-post-publish-evidence.mjs
 * Must be run from the vscode/ directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SCRIPT_VERSION = '1.0.0';
const RELEASE_VERIFY_VERSION = '1.0.0';
const RELEASE_VERIFY_DOCS_VERSION = '1.0.0';

const root = process.cwd();
const distDir = path.join(root, 'dist');

const packageJsonPath = path.join(root, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  fatal('package.json not found in current directory. Run from vscode/ root.');
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
if (!version || typeof version !== 'string') {
  fatal('Invalid version field in package.json.');
}

console.log(`\n=== Ranvier VSCode Post-Publish Evidence (v${version}) ===\n`);

/** @type {Array<{name: string, passed: boolean, detail: string}>} */
const checks = [];
let allPassed = true;

// --- Check 1: release-verify ---
{
  const name = 'release-verify';
  try {
    const output = execSync('node ./scripts/release-verify.mjs', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    checks.push({ name, passed: true, detail: output.trim() });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || err.message;
    checks.push({ name, passed: false, detail: stderr });
    console.error(`[FAIL] ${name}: ${stderr}`);
    allPassed = false;
  }
}

// --- Check 2: release-verify-docs ---
{
  const name = 'release-verify-docs';
  try {
    const output = execSync('node ./scripts/release-verify-docs.mjs', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    checks.push({ name, passed: true, detail: output.trim() });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || err.message;
    checks.push({ name, passed: false, detail: stderr });
    console.error(`[FAIL] ${name}: ${stderr}`);
    allPassed = false;
  }
}

// --- Check 3: VSIX artifact exists and has expected size ---
{
  const name = 'vsix-artifact';
  const vsixPath = path.join(root, `ranvier-vscode-${version}.vsix`);

  if (!fs.existsSync(vsixPath)) {
    checks.push({
      name,
      passed: false,
      detail: `VSIX not found: ${path.basename(vsixPath)}`,
    });
    console.error(`[FAIL] ${name}: VSIX artifact not found at ${vsixPath}`);
    allPassed = false;
  } else {
    const stats = fs.statSync(vsixPath);
    const sizeBytes = stats.size;
    const MIN_VSIX_SIZE = 1024; // 1 KB minimum sanity check

    if (sizeBytes < MIN_VSIX_SIZE) {
      checks.push({
        name,
        passed: false,
        detail: `VSIX too small: ${sizeBytes} bytes (minimum ${MIN_VSIX_SIZE})`,
      });
      console.error(
        `[FAIL] ${name}: VSIX artifact is suspiciously small (${sizeBytes} bytes)`
      );
      allPassed = false;
    } else {
      checks.push({
        name,
        passed: true,
        detail: `${path.basename(vsixPath)} (${sizeBytes} bytes)`,
      });
      console.log(`[PASS] ${name}: ${sizeBytes} bytes`);
    }
  }
}

// --- Write evidence JSON ---
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const vsixPath = path.join(root, `ranvier-vscode-${version}.vsix`);
const artifactSize = fs.existsSync(vsixPath)
  ? fs.statSync(vsixPath).size
  : null;

const evidence = {
  version,
  timestamp: new Date().toISOString(),
  allPassed,
  checksTotal: checks.length,
  checksPassed: checks.filter((c) => c.passed).length,
  checksFailed: checks.filter((c) => !c.passed).length,
  artifactSizeBytes: artifactSize,
  checks,
  verifierVersions: {
    'ci-post-publish-evidence': SCRIPT_VERSION,
    'release-verify': RELEASE_VERIFY_VERSION,
    'release-verify-docs': RELEASE_VERIFY_DOCS_VERSION,
  },
};

const evidencePath = path.join(distDir, `publish-evidence-${version}.json`);
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');

console.log(`\n--- Evidence written to ${path.relative(root, evidencePath)} ---`);

if (allPassed) {
  console.log(`\nAll ${checks.length} checks passed for v${version}.\n`);
} else {
  const failed = checks.filter((c) => !c.passed);
  console.error(
    `\n${failed.length} of ${checks.length} checks FAILED for v${version}.\n`
  );
  process.exit(1);
}

function fatal(message) {
  console.error(`Fatal: ${message}`);
  process.exit(2);
}

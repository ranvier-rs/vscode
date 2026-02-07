import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveSourceFilePath } from './source-resolution';

test('returns workspace-not-open when workspace is missing', () => {
  const result = resolveSourceFilePath(undefined, 'src/main.rs', 1);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'workspace-not-open');
  }
});

test('returns missing-source-file when path is empty', () => {
  const result = resolveSourceFilePath('C:/repo', '', 1);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing-source-file');
  }
});

test('resolves existing file path with normalized line', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ranvier-vscode-test-'));
  const file = path.join(root, 'src', 'main.rs');
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, 'fn main() {}', 'utf8');

  const result = resolveSourceFilePath(root, 'src\\main.rs', 0);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.line, 1);
    assert.equal(result.filePath, file);
  }
});

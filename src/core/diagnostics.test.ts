import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNodeDiagnostics, summarizeNodeDiagnostics } from './diagnostics';

test('parses diagnostics with node_id and nodeId variants', () => {
  const parsed = parseNodeDiagnostics({
    diagnostics: [
      { node_id: 'n1', severity: 'error', message: 'failed', source: 'runtime' },
      { nodeId: 'n1', severity: 'warning', message: 'slow', source: 'lint' },
      { nodeId: 'n2', severity: 'unknown', message: 'note' }
    ]
  });

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.severity, 'error');
  assert.equal(parsed[1]?.severity, 'warning');
  assert.equal(parsed[2]?.severity, 'info');
  assert.equal(parsed[2]?.source, 'unknown');
});

test('summarizes diagnostics per node and sorts by severity', () => {
  const summary = summarizeNodeDiagnostics(
    parseNodeDiagnostics([
      { node_id: 'n1', severity: 'warning', message: 'warn', source: 'lint' },
      { node_id: 'n1', severity: 'error', message: 'boom', source: 'runtime' },
      { node_id: 'n1', severity: 'info', message: 'hint', source: 'lint' },
      { node_id: 'n2', severity: 'error', message: 'x', source: 'runtime' }
    ])
  );

  const n1 = summary.get('n1');
  assert.ok(n1);
  assert.equal(n1.error, 1);
  assert.equal(n1.warning, 1);
  assert.equal(n1.info, 1);
  assert.deepEqual(
    n1.items.map((item) => item.severity),
    ['error', 'warning', 'info']
  );

  const n2 = summary.get('n2');
  assert.ok(n2);
  assert.equal(n2.error, 1);
});

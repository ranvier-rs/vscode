import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectNodeProblems } from './problems';

test('projects node diagnostics only when source mapping exists', () => {
  const projected = projectNodeProblems([
    {
      id: 'n1',
      label: 'Node A',
      position: { x: 0, y: 0 },
      sourceLocation: { file: 'src/a.rs', line: 10 },
      diagnostics: {
        error: 1,
        warning: 0,
        info: 0,
        items: [{ nodeId: 'n1', severity: 'error', message: 'boom', source: 'runtime' }]
      }
    },
    {
      id: 'n2',
      label: 'Node B',
      position: { x: 0, y: 0 },
      diagnostics: {
        error: 0,
        warning: 1,
        info: 0,
        items: [{ nodeId: 'n2', severity: 'warning', message: 'warn', source: 'lint' }]
      }
    }
  ]);

  assert.equal(projected.length, 1);
  assert.deepEqual(projected[0], {
    nodeId: 'n1',
    nodeLabel: 'Node A',
    relativeFilePath: 'src/a.rs',
    line: 10,
    severity: 'error',
    message: 'boom',
    source: 'runtime'
  });
});

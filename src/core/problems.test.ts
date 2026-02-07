import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNodeIdFromDiagnosticMessage,
  findNodeIdFromDiagnosticsAtLine,
  projectNodeProblems
} from './problems';

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

test('extracts node id from projected diagnostic message', () => {
  assert.equal(extractNodeIdFromDiagnosticMessage('[Node A#n1] boom'), 'n1');
  assert.equal(extractNodeIdFromDiagnosticMessage('[Node-X#n-2] warn'), 'n-2');
  assert.equal(extractNodeIdFromDiagnosticMessage('plain message'), undefined);
});

test('finds node id from diagnostics at selected line', () => {
  const diagnostics = [
    {
      range: { start: { line: 9 } },
      message: '[Node A#n1] boom'
    },
    {
      range: { start: { line: 11 } },
      message: '[Node B#n2] warn'
    }
  ];

  assert.equal(findNodeIdFromDiagnosticsAtLine(diagnostics as any, 9), 'n1');
  assert.equal(findNodeIdFromDiagnosticsAtLine(diagnostics as any, 11), 'n2');
  assert.equal(findNodeIdFromDiagnosticsAtLine(diagnostics as any, 12), undefined);
});

test('prioritizes cursor-matched and ranvier diagnostics on the same line', () => {
  const diagnostics = [
    {
      range: { start: { line: 9, character: 0 }, end: { line: 9, character: 8 } },
      message: '[Node A#n1] lint issue',
      source: 'eslint',
      severity: 1
    },
    {
      range: { start: { line: 9, character: 18 }, end: { line: 9, character: 26 } },
      message: '[Node B#n2] runtime issue',
      source: 'ranvier:runtime',
      severity: 2
    }
  ];

  assert.equal(findNodeIdFromDiagnosticsAtLine(diagnostics as any, 9, 20), 'n2');
  assert.equal(findNodeIdFromDiagnosticsAtLine(diagnostics as any, 9, 2), 'n1');
});

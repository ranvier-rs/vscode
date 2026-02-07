import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCircuitPayload } from './schematic';

test('parses source_location variants consistently', () => {
  const payload = parseCircuitPayload({
    nodes: [
      { id: 'n1', label: 'A', source_location: { file: 'src\\a.rs', line: 10 } },
      { id: 'n2', label: 'B', sourceLocation: { file: 'src/b.rs', line: 20 } },
      { id: 'n3', label: 'C', metadata: { source_location: { file: 'src\\c.rs' } } },
      { id: 'n4', label: 'D', metadata: { sourceLocation: { file: 'src/d.rs', line: 4 } } }
    ],
    edges: []
  });

  assert.equal(payload.nodes[0]?.sourceLocation?.file, 'src/a.rs');
  assert.equal(payload.nodes[1]?.sourceLocation?.file, 'src/b.rs');
  assert.equal(payload.nodes[2]?.sourceLocation?.file, 'src/c.rs');
  assert.equal(payload.nodes[3]?.sourceLocation?.line, 4);
});

test('parses edge endpoints from both source/target and from/to', () => {
  const payload = parseCircuitPayload({
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', from: 'b', to: 'c' },
      { id: 'e3', from: 'a' }
    ]
  });

  assert.equal(payload.edges.length, 2);
  assert.deepEqual(
    payload.edges.map((edge) => [edge.id, edge.source, edge.target]),
    [
      ['e1', 'a', 'b'],
      ['e2', 'b', 'c']
    ]
  );
});

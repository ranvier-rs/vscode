import { parseCircuitPayload } from '../src/core/schematic';

type RawSchematic = {
  nodes: Array<{
    id: string;
    label: string;
    source_location: { file: string; line: number };
    position: { x: number; y: number };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
  }>;
};

const nodeCount = Number(process.env.RANVIER_PERF_NODES ?? 3000);
const edgeCount = Math.max(nodeCount - 1, 0);
const raw = buildRawSchematic(nodeCount, edgeCount);

const startedAt = performance.now();
const parsed = parseCircuitPayload(raw);
const elapsed = performance.now() - startedAt;

console.log(
  `[perf:schematic] nodes=${parsed.nodes.length} edges=${parsed.edges.length} parse_ms=${elapsed.toFixed(2)}`
);

function buildRawSchematic(nodes: number, edges: number): RawSchematic {
  const rawNodes = Array.from({ length: nodes }, (_, index) => ({
    id: `n-${index}`,
    label: `Node ${index}`,
    source_location: {
      file: `src/path/mod_${Math.floor(index / 100)}.rs`,
      line: (index % 120) + 1
    },
    position: { x: (index % 60) * 120, y: Math.floor(index / 60) * 84 }
  }));

  const rawEdges = Array.from({ length: edges }, (_, index) => ({
    id: `e-${index}`,
    source: `n-${index}`,
    target: `n-${index + 1}`,
    label: 'flow'
  }));

  return {
    nodes: rawNodes,
    edges: rawEdges
  };
}

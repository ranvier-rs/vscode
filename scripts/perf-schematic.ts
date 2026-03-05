import { parseCircuitPayload } from '../src/core/schematic';
import { projectNodeProblems } from '../src/core/problems';

type RawSchematic = {
  nodes: Array<{
    id: string;
    label: string;
    source_location: { file: string; line: number };
    position: { x: number; y: number };
    diagnostics?: {
      error: number;
      warning: number;
      info: number;
      items: Array<{ nodeId: string; severity: string; message: string; source: string }>;
    };
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
const diagnosticRatio = Number(process.env.RANVIER_PERF_DIAG_RATIO ?? 0.3);
const raw = buildRawSchematic(nodeCount, edgeCount, diagnosticRatio);

// Benchmark 1: schematic parsing
const parseStart = performance.now();
const parsed = parseCircuitPayload(raw);
const parseMs = performance.now() - parseStart;

console.log(
  `[perf:schematic] nodes=${parsed.nodes.length} edges=${parsed.edges.length} parse_ms=${parseMs.toFixed(2)}`
);

// Benchmark 2: Problems projection
// In the real extension, diagnostics are attached to nodes after parsing (via diagnostics.json overlay).
// Simulate this by attaching diagnostics to the parsed nodes before projection.
const nodesWithDiagnostics = parsed.nodes.map((node, index) => {
  const hasDiag = index / parsed.nodes.length < diagnosticRatio;
  return {
    ...node,
    ...(hasDiag
      ? {
          diagnostics: {
            error: 1,
            warning: 0,
            info: 0,
            items: [
              {
                nodeId: node.id,
                severity: 'error' as const,
                message: `[${node.label}#${node.id}] synthetic diagnostic`,
                source: 'ranvier:runtime'
              }
            ]
          }
        }
      : {})
  };
});

const projStart = performance.now();
const projected = projectNodeProblems(nodesWithDiagnostics);
const projMs = performance.now() - projStart;

console.log(
  `[perf:problems] projected=${projected.length} projection_ms=${projMs.toFixed(2)}`
);

// Summary
const totalMs = parseMs + projMs;
console.log(
  `[perf:total] parse+problems=${totalMs.toFixed(2)}ms (${nodeCount} nodes, ${Math.round(diagnosticRatio * 100)}% with diagnostics)`
);

if (totalMs > 1000) {
  console.error(`[perf:warning] total exceeds 1000ms budget`);
  process.exit(1);
}

function buildRawSchematic(nodes: number, edges: number, diagRatio: number): RawSchematic {
  const rawNodes = Array.from({ length: nodes }, (_, index) => {
    const hasDiag = index / nodes < diagRatio;
    return {
      id: `n-${index}`,
      label: `Node ${index}`,
      source_location: {
        file: `src/path/mod_${Math.floor(index / 100)}.rs`,
        line: (index % 120) + 1
      },
      position: { x: (index % 60) * 120, y: Math.floor(index / 60) * 84 },
      ...(hasDiag
        ? {
            diagnostics: {
              error: 1,
              warning: 0,
              info: 0,
              items: [
                {
                  nodeId: `n-${index}`,
                  severity: 'error' as const,
                  message: `[Node ${index}#n-${index}] synthetic diagnostic`,
                  source: 'ranvier:runtime'
                }
              ]
            }
          }
        : {})
    };
  });

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

import type { CircuitNode, DiagnosticSeverity } from '../shared/types';

export type ProjectedNodeProblem = {
  nodeId: string;
  nodeLabel: string;
  relativeFilePath: string;
  line: number;
  severity: DiagnosticSeverity;
  message: string;
  source: string;
};

export function projectNodeProblems(nodes: CircuitNode[]): ProjectedNodeProblem[] {
  const problems: ProjectedNodeProblem[] = [];

  for (const node of nodes) {
    if (!node.sourceLocation?.file || !node.diagnostics?.items?.length) {
      continue;
    }

    const line = Math.max(1, node.sourceLocation.line ?? 1);
    for (const item of node.diagnostics.items) {
      problems.push({
        nodeId: node.id,
        nodeLabel: node.label,
        relativeFilePath: node.sourceLocation.file,
        line,
        severity: item.severity,
        message: item.message,
        source: item.source
      });
    }
  }

  return problems;
}

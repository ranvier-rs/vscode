import type { CircuitNode, DiagnosticSeverity } from '../shared/types';
import type * as vscode from 'vscode';

export type ProjectedNodeProblem = {
  nodeId: string;
  nodeLabel: string;
  relativeFilePath: string;
  line: number;
  severity: DiagnosticSeverity;
  message: string;
  source: string;
};

const NODE_TAG_PATTERN = /^\[[^#\]]+#([^\]]+)\]/;

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

export function extractNodeIdFromDiagnosticMessage(message: string): string | undefined {
  const match = message.match(NODE_TAG_PATTERN);
  const nodeId = match?.[1]?.trim();
  return nodeId ? nodeId : undefined;
}

export function findNodeIdFromDiagnosticsAtLine(
  diagnostics: readonly vscode.Diagnostic[],
  line: number,
  character?: number
): string | undefined {
  let bestNodeId: string | undefined;
  let bestScore: [number, number, number, number] | undefined;

  for (const diagnostic of diagnostics) {
    if (diagnostic.range.start.line !== line) {
      continue;
    }
    const nodeId = extractNodeIdFromDiagnosticMessage(diagnostic.message);
    if (!nodeId) {
      continue;
    }

    const score = diagnosticPriorityScore(diagnostic, character);
    if (!bestScore || comparePriorityScore(score, bestScore) > 0) {
      bestNodeId = nodeId;
      bestScore = score;
    }
  }

  return bestNodeId;
}

function diagnosticPriorityScore(
  diagnostic: vscode.Diagnostic,
  character: number | undefined
): [number, number, number, number] {
  const startChar = diagnostic.range.start?.character ?? 0;
  const endChar = diagnostic.range.end?.character ?? startChar;
  const cursorMatched =
    character === undefined ? 0 : character >= startChar && character <= Math.max(startChar, endChar) ? 1 : 0;
  const source = typeof diagnostic.source === 'string' ? diagnostic.source.toLowerCase() : '';
  const ranvierSource = source.startsWith('ranvier:') ? 1 : 0;
  const severityRank = toSeverityRank(diagnostic.severity);
  const distanceScore = character === undefined ? 0 : -Math.abs(startChar - character);
  return [cursorMatched, ranvierSource, severityRank, distanceScore];
}

function comparePriorityScore(
  left: [number, number, number, number],
  right: [number, number, number, number]
): number {
  const [l0, l1, l2, l3] = left;
  const [r0, r1, r2, r3] = right;
  if (l0 !== r0) return l0 > r0 ? 1 : -1;
  if (l1 !== r1) return l1 > r1 ? 1 : -1;
  if (l2 !== r2) return l2 > r2 ? 1 : -1;
  if (l3 !== r3) return l3 > r3 ? 1 : -1;
  return 0;
}

function toSeverityRank(severity: unknown): number {
  if (typeof severity !== 'number' || !Number.isFinite(severity)) {
    return 0;
  }
  // VSCode severity: Error(0), Warning(1), Information(2), Hint(3)
  return Math.max(0, 4 - severity);
}

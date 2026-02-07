import type { CircuitEdge, CircuitNode } from '../shared/types';

export type RawNode = {
  id?: string;
  label?: string;
  metadata?: {
    label?: string;
    source_location?: { file?: string; line?: number };
    sourceLocation?: { file?: string; line?: number };
  };
  source_location?: { file?: string; line?: number };
  sourceLocation?: { file?: string; line?: number };
  position?: { x?: number; y?: number };
};

export type RawEdge = {
  id?: string;
  source?: string;
  target?: string;
  from?: string;
  to?: string;
  label?: string;
};

export type RawSchematic = {
  nodes?: RawNode[];
  edges?: RawEdge[];
};

export type CircuitPayload = {
  nodes: CircuitNode[];
  edges: CircuitEdge[];
};

export function parseCircuitPayload(parsed: RawSchematic): CircuitPayload {
  const nodes: CircuitNode[] = (parsed.nodes ?? []).map((node, index) => {
    const sourceLocation =
      normalizeSourceLocation(node.source_location) ??
      normalizeSourceLocation(node.sourceLocation) ??
      normalizeSourceLocation(node.metadata?.source_location) ??
      normalizeSourceLocation(node.metadata?.sourceLocation);

    return {
      id: node.id ?? `node-${index}`,
      label: node.label ?? node.metadata?.label ?? node.id ?? `Node ${index + 1}`,
      position: {
        x: node.position?.x ?? 100 + index * 200,
        y: node.position?.y ?? (index % 2 === 0 ? 120 : 300)
      },
      sourceLocation
    };
  });

  const edges: CircuitEdge[] = (parsed.edges ?? [])
    .map((edge, index) => ({
      id: edge.id ?? `edge-${index}`,
      source: edge.source ?? edge.from ?? '',
      target: edge.target ?? edge.to ?? '',
      label: edge.label
    }))
    .filter((edge) => edge.source.length > 0 && edge.target.length > 0);

  return { nodes, edges };
}

export function normalizeSourceLocation(
  source:
    | {
        file?: string;
        line?: number;
      }
    | undefined
): CircuitNode['sourceLocation'] {
  if (!source?.file) {
    return undefined;
  }
  return {
    file: normalizePath(source.file),
    line: source.line
  };
}

export function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
}

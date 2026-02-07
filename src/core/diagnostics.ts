import type {
  DiagnosticSeverity,
  NodeDiagnostic,
  NodeDiagnosticsSummary
} from '../shared/types';

type RawDiagnostic = {
  node_id?: string;
  nodeId?: string;
  severity?: string;
  message?: string;
  source?: string;
};

type RawDiagnosticsPayload =
  {
    diagnostics?: RawDiagnostic[];
  };

const SEVERITY_ORDER: DiagnosticSeverity[] = ['error', 'warning', 'info'];

export function parseNodeDiagnostics(payload: unknown): NodeDiagnostic[] {
  const diagnostics = extractDiagnostics(payload);
  return diagnostics
    .map(normalizeDiagnostic)
    .filter((item): item is NodeDiagnostic => item !== null);
}

export function summarizeNodeDiagnostics(items: NodeDiagnostic[]): Map<string, NodeDiagnosticsSummary> {
  const map = new Map<string, NodeDiagnosticsSummary>();

  for (const item of items) {
    const summary = map.get(item.nodeId) ?? { error: 0, warning: 0, info: 0, items: [] };
    summary[item.severity] += 1;
    summary.items.push(item);
    map.set(item.nodeId, summary);
  }

  for (const summary of map.values()) {
    summary.items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  }

  return map;
}

function extractDiagnostics(payload: unknown): RawDiagnostic[] {
  if (Array.isArray(payload)) {
    return payload as RawDiagnostic[];
  }
  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as RawDiagnosticsPayload).diagnostics)
  ) {
    return (payload as RawDiagnosticsPayload).diagnostics as RawDiagnostic[];
  }
  return [];
}

function normalizeDiagnostic(raw: RawDiagnostic): NodeDiagnostic | null {
  const nodeId = (raw.node_id ?? raw.nodeId ?? '').trim();
  const message = (raw.message ?? '').trim();
  if (!nodeId || !message) {
    return null;
  }

  return {
    nodeId,
    severity: normalizeSeverity(raw.severity),
    message,
    source: (raw.source ?? 'unknown').trim() || 'unknown'
  };
}

function normalizeSeverity(input: string | undefined): DiagnosticSeverity {
  const value = (input ?? '').toLowerCase();
  if (value === 'error' || value === 'warning' || value === 'info') {
    return value;
  }
  return 'info';
}

function severityRank(severity: DiagnosticSeverity): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

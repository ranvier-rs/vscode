export type Position = {
  x: number;
  y: number;
};

export type CircuitNode = {
  id: string;
  label: string;
  position: Position;
  sourceLocation?: {
    file: string;
    line?: number;
  };
  diagnostics?: NodeDiagnosticsSummary;
};

export type CircuitEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type NodeDiagnostic = {
  nodeId: string;
  severity: DiagnosticSeverity;
  message: string;
  source: string;
};

export type NodeDiagnosticsSummary = {
  error: number;
  warning: number;
  info: number;
  items: NodeDiagnostic[];
};

export type ServerConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type NodeMetrics = {
  throughput: number;
  errorCount: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyAvg: number;
  sampleCount: number;
};

export type MetricsSnapshot = {
  circuit: string;
  windowMs: number;
  nodes: Record<string, NodeMetrics>;
};

export type HeatmapMode = 'none' | 'traffic' | 'latency' | 'errors';

export type InspectorEvent = {
  timestamp: number;
  eventType: string;
  nodeId?: string;
  circuit?: string;
  durationMs?: number;
  outcomeType?: string;
};

export type StallInfo = {
  nodeId: string;
  circuit: string;
  stalledMs: number;
  thresholdMs: number;
};

export type ExtensionToWebviewMessage =
  | {
    type: 'init';
    payload: {
      nodes: CircuitNode[];
      edges: CircuitEdge[];
      activeFile?: string;
      diagnosticsUpdatedAt?: string;
      locale?: string;
      translations?: any;
      focusedNodeId?: string;
    };
  }
  | {
    type: 'highlight-by-file';
    payload: {
      activeFile?: string;
    };
  }
  | {
    type: 'highlight-node';
    payload: {
      nodeId?: string;
    };
  }
  | {
    type: 'export-result';
    payload: {
      ok: boolean;
      message: string;
    };
  }
  | {
    type: 'execution-paused';
    payload: {
      traceId: string;
      nodeId: string;
    };
  }
  | {
    type: 'execution-resumed';
    payload: {
      traceId: string;
    };
  }
  | {
    type: 'server-status';
    payload: {
      state: ServerConnectionState;
      url: string;
    };
  }
  | {
    type: 'metrics-update';
    payload: {
      circuits: MetricsSnapshot[];
    };
  }
  | {
    type: 'inspector-event';
    payload: {
      event: InspectorEvent;
    };
  }
  | {
    type: 'stall-detected';
    payload: {
      stalls: StallInfo[];
    };
  };

export type WebviewToExtensionMessage =
  | {
    type: 'ready';
  }
  | {
    type: 'node-click';
    payload: {
      id: string;
    };
  }
  | {
    type: 'run-schematic-export';
  }
  | {
    type: 'refresh-diagnostics';
  }
  | {
    type: 'update-node-layout';
    payload: {
      nodeId: string;
      x: number;
      y: number;
    };
  }
  | {
    type: 'add-transition-node';
    payload: {
      label: string;
      snippet: string;
      x: number;
      y: number;
    };
  }
  | {
    type: 'debug-resume';
    payload: {
      traceId: string;
    };
  }
  | {
    type: 'debug-step';
    payload: {
      traceId: string;
    };
  }
  | {
    type: 'debug-pause';
    payload: {
      traceId: string;
    };
  };

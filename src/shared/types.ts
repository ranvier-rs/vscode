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

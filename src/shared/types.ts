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
      };
    }
  | {
      type: 'highlight-by-file';
      payload: {
        activeFile?: string;
      };
    }
  | {
      type: 'export-result';
      payload: {
        ok: boolean;
        message: string;
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
    };

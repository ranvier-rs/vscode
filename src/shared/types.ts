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
};

export type CircuitEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type ExtensionToWebviewMessage =
  | {
      type: 'init';
      payload: {
        nodes: CircuitNode[];
        edges: CircuitEdge[];
        activeFile?: string;
      };
    }
  | {
      type: 'highlight-by-file';
      payload: {
        activeFile?: string;
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
    };

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

// ── API Explorer Types (M202) ────────────────────────────────────

export type ApiEndpoint = {
  method: string;
  path: string;
  circuitName?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

export type ApiRequestData = {
  method: string;
  path: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body?: unknown;
  auth: ApiAuthConfig;
};

export type ApiAuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; headerName: string; value: string }
  | { type: 'custom'; headerName: string; headerValue: string };

export type ApiResponseData = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
  traceId?: string;
  contentType?: string;
};

export type ApiTimelineNode = {
  nodeId: string;
  label: string;
  durationMs: number;
  outcome: 'ok' | 'error' | 'skipped';
  input?: unknown;
  output?: unknown;
};

export type ApiExplorerState = 'idle' | 'sending' | 'success' | 'error';

export type ConnectionMode = 'connected' | 'disconnected-cached' | 'offline';

// ── Collection Types (M203) ─────────────────────────────────────

export type RequestAssertion = {
  target: string;
  operator: string;
  expected: unknown;
};

export type RequestPreset = {
  name: string;
  body?: unknown;
  source?: 'manual' | 'faker' | 'imported';
  seed?: number;
};

export type CollectionRequest = {
  id: string;
  name: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body?: unknown;
  auth?: ApiAuthConfig;
  assertions?: RequestAssertion[];
  captures?: Record<string, string>;
  source?: 'manual' | 'faker' | 'imported';
  presets?: RequestPreset[];
  lastStatus?: number;
  lastDurationMs?: number;
  lastExecutedAt?: string;
};

export type Collection = {
  schema_version: string;
  name: string;
  version?: string;
  description?: string;
  requests: CollectionRequest[];
};

export type CollectionMeta = {
  name: string;
  requestCount: number;
  lastModified: string;
};

export type HistoryEntry = {
  id: string;
  requestId: string;
  requestName: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  executedAt: string;
  body?: unknown;
  responseBody?: unknown;
};

export type WorkspaceState = {
  initialized: boolean;
  collections: CollectionMeta[];
  activeCollection?: string;
};

// ── Environment Types (M204) ──────────────────────────────────

export type EnvironmentConfig = {
  name: string;
  variables: Record<string, string>;
};

export type EnvironmentMeta = {
  name: string;
  lastModified: string;
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
  }
  // ── API Explorer messages (M202) ──
  | {
    type: 'api-endpoints';
    payload: {
      endpoints: ApiEndpoint[];
    };
  }
  | {
    type: 'api-response';
    payload: ApiResponseData;
  }
  | {
    type: 'api-timeline';
    payload: {
      nodes: ApiTimelineNode[];
    };
  }
  | {
    type: 'api-connection-mode';
    payload: {
      mode: ConnectionMode;
    };
  }
  | {
    type: 'direct-response';
    payload: ApiResponseData;
  }
  // ── Collection messages (M203) ──
  | {
    type: 'collections-loaded';
    payload: {
      collections: CollectionMeta[];
      activeCollection?: string;
    };
  }
  | {
    type: 'collection-loaded';
    payload: {
      collection: Collection;
    };
  }
  | {
    type: 'request-saved';
    payload: {
      collectionName: string;
      request: CollectionRequest;
    };
  }
  | {
    type: 'request-deleted';
    payload: {
      collectionName: string;
      requestId: string;
    };
  }
  | {
    type: 'history-loaded';
    payload: {
      entries: HistoryEntry[];
    };
  }
  | {
    type: 'workspace-state';
    payload: WorkspaceState;
  }
  // ── Template/Faker/Preset/Environment messages (M204) ──
  | {
    type: 'template-generated';
    payload: {
      body: unknown;
      source: 'server' | 'client';
    };
  }
  | {
    type: 'sample-generated';
    payload: {
      body: unknown;
      source: 'server' | 'client';
    };
  }
  | {
    type: 'presets-loaded';
    payload: {
      collectionName: string;
      requestId: string;
      presets: RequestPreset[];
    };
  }
  | {
    type: 'environments-loaded';
    payload: {
      environments: EnvironmentMeta[];
      activeEnvironment?: string;
    };
  }
  | {
    type: 'environment-loaded';
    payload: {
      environment: EnvironmentConfig;
    };
  }
  // ── Export/Import messages (M205) ──
  | {
    type: 'export-complete';
    payload: {
      path: string;
      itemCount: number;
    };
  }
  | {
    type: 'import-complete';
    payload: {
      collections: number;
      environments: number;
    };
  }
  | {
    type: 'import-conflicts';
    payload: {
      conflicts: { type: string; name: string; existingItemCount?: number }[];
    };
  }
  // ── Batch Execution & Validation messages (M206) ──
  | {
    type: 'batch-progress';
    payload: {
      current: number;
      total: number;
      requestName: string;
    };
  }
  | {
    type: 'batch-complete';
    payload: {
      total: number;
      passed: number;
      failed: number;
      errors: number;
      skipped: number;
      totalDurationMs: number;
      results: {
        requestId: string;
        requestName: string;
        status: 'passed' | 'failed' | 'error' | 'skipped';
        responseStatus: number;
        durationMs: number;
        assertionsPassed: number;
        assertionsTotal: number;
        error?: string;
      }[];
    };
  }
  | {
    type: 'validation-result';
    payload: {
      valid: number;
      warnings: number;
      errors: number;
      diagnostics: { path: string; severity: 'error' | 'warning' | 'info'; message: string }[];
    };
  }
  | {
    type: 'keyboard-action';
    payload: {
      action: 'send' | 'template' | 'faker';
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
  }
  // ── API Explorer messages (M202) ──
  | {
    type: 'fetch-routes';
  }
  | {
    type: 'send-request';
    payload: {
      method: string;
      path: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
  }
  | {
    type: 'fetch-timeline';
    payload: {
      traceId: string;
    };
  }
  | {
    type: 'direct-request';
    payload: {
      url: string;
      method: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
  }
  | {
    type: 'api-reveal-node';
    payload: {
      nodeId: string;
    };
  }
  // ── Collection messages (M203) ──
  | {
    type: 'load-collections';
  }
  | {
    type: 'load-collection';
    payload: {
      name: string;
    };
  }
  | {
    type: 'save-request';
    payload: {
      collectionName: string;
      request: CollectionRequest;
    };
  }
  | {
    type: 'delete-request';
    payload: {
      collectionName: string;
      requestId: string;
    };
  }
  | {
    type: 'duplicate-request';
    payload: {
      collectionName: string;
      requestId: string;
    };
  }
  | {
    type: 'rename-request';
    payload: {
      collectionName: string;
      requestId: string;
      newName: string;
    };
  }
  | {
    type: 'create-collection';
    payload: {
      name: string;
    };
  }
  | {
    type: 'delete-collection';
    payload: {
      name: string;
    };
  }
  | {
    type: 'load-history';
    payload: {
      limit?: number;
    };
  }
  | {
    type: 'init-workspace';
  }
  // ── Template/Faker/Preset/Environment messages (M204) ──
  | {
    type: 'generate-template';
    payload: {
      method: string;
      path: string;
      schema?: unknown;
    };
  }
  | {
    type: 'generate-sample';
    payload: {
      method: string;
      path: string;
      schema?: unknown;
    };
  }
  | {
    type: 'save-preset';
    payload: {
      collectionName: string;
      requestId: string;
      preset: RequestPreset;
    };
  }
  | {
    type: 'delete-preset';
    payload: {
      collectionName: string;
      requestId: string;
      presetName: string;
    };
  }
  | {
    type: 'load-presets';
    payload: {
      collectionName: string;
      requestId: string;
    };
  }
  | {
    type: 'load-environments';
  }
  | {
    type: 'load-environment';
    payload: {
      name: string;
    };
  }
  | {
    type: 'save-environment';
    payload: {
      environment: EnvironmentConfig;
    };
  }
  | {
    type: 'switch-environment';
    payload: {
      name: string;
    };
  }
  // ── Export/Import messages (M205) ──
  | {
    type: 'export-bundle';
    payload: {
      collectionNames: string[];
      environmentNames: string[];
      redactionStrategy: 'redact' | 'strip' | 'include';
    };
  }
  | {
    type: 'export-request';
    payload: {
      collectionName: string;
      requestId: string;
      includeResponse: boolean;
    };
  }
  | {
    type: 'import-file';
  }
  | {
    type: 'resolve-conflicts';
    payload: {
      resolution: 'replace' | 'skip';
    };
  }
  // ── Batch Execution & Validation messages (M206) ──
  | {
    type: 'batch-send';
    payload: {
      requestIds: string[];
    };
  }
  | {
    type: 'batch-cancel';
  }
  | {
    type: 'validate-body';
    payload: {
      body: unknown;
      schema: unknown;
    };
  };

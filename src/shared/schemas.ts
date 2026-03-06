import { z } from 'zod';

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const NodeDiagnosticsSummarySchema = z.object({
  error: z.number(),
  warning: z.number(),
  info: z.number(),
  items: z.array(z.object({
    nodeId: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    source: z.string(),
  })),
});

export const CircuitNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  position: PositionSchema,
  sourceLocation: z.object({
    file: z.string(),
    line: z.number().optional(),
  }).optional(),
  diagnostics: NodeDiagnosticsSummarySchema.optional(),
});

export const CircuitEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});

export const ExtensionToWebviewMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    payload: z.object({
      nodes: z.array(CircuitNodeSchema),
      edges: z.array(CircuitEdgeSchema),
      activeFile: z.string().optional(),
      diagnosticsUpdatedAt: z.string().optional(),
      locale: z.string().optional(),
      translations: z.any().optional(),
      focusedNodeId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('highlight-by-file'),
    payload: z.object({
      activeFile: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('highlight-node'),
    payload: z.object({
      nodeId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('export-result'),
    payload: z.object({
      ok: z.boolean(),
      message: z.string(),
    }),
  }),
  z.object({
    type: z.literal('execution-paused'),
    payload: z.object({
      traceId: z.string(),
      nodeId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('execution-resumed'),
    payload: z.object({
      traceId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('server-status'),
    payload: z.object({
      state: z.enum(['disconnected', 'connecting', 'connected', 'error']),
      url: z.string(),
    }),
  }),
  z.object({
    type: z.literal('metrics-update'),
    payload: z.object({
      circuits: z.array(z.object({
        circuit: z.string(),
        windowMs: z.number(),
        nodes: z.record(z.string(), z.object({
          throughput: z.number(),
          errorCount: z.number(),
          errorRate: z.number(),
          latencyP50: z.number(),
          latencyP95: z.number(),
          latencyP99: z.number(),
          latencyAvg: z.number(),
          sampleCount: z.number(),
        })),
      })),
    }),
  }),
  z.object({
    type: z.literal('inspector-event'),
    payload: z.object({
      event: z.object({
        timestamp: z.number(),
        eventType: z.string(),
        nodeId: z.string().optional(),
        circuit: z.string().optional(),
        durationMs: z.number().optional(),
        outcomeType: z.string().optional(),
      }),
    }),
  }),
  z.object({
    type: z.literal('stall-detected'),
    payload: z.object({
      stalls: z.array(z.object({
        nodeId: z.string(),
        circuit: z.string(),
        stalledMs: z.number(),
        thresholdMs: z.number(),
      })),
    }),
  }),
  // API Explorer messages (M202)
  z.object({
    type: z.literal('api-endpoints'),
    payload: z.object({
      endpoints: z.array(z.object({
        method: z.string(),
        path: z.string(),
        circuitName: z.string().optional(),
        inputSchema: z.unknown().optional(),
        outputSchema: z.unknown().optional(),
      })),
    }),
  }),
  z.object({
    type: z.literal('api-response'),
    payload: z.object({
      status: z.number(),
      headers: z.record(z.string(), z.string()),
      body: z.unknown(),
      durationMs: z.number(),
      traceId: z.string().optional(),
      contentType: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('api-timeline'),
    payload: z.object({
      nodes: z.array(z.object({
        nodeId: z.string(),
        label: z.string(),
        durationMs: z.number(),
        outcome: z.enum(['ok', 'error', 'skipped']),
        input: z.unknown().optional(),
        output: z.unknown().optional(),
      })),
    }),
  }),
  z.object({
    type: z.literal('api-connection-mode'),
    payload: z.object({
      mode: z.enum(['connected', 'disconnected-cached', 'offline']),
    }),
  }),
  z.object({
    type: z.literal('direct-response'),
    payload: z.object({
      status: z.number(),
      headers: z.record(z.string(), z.string()),
      body: z.unknown(),
      durationMs: z.number(),
      traceId: z.string().optional(),
      contentType: z.string().optional(),
    }),
  }),
  // Collection messages (M203)
  z.object({
    type: z.literal('collections-loaded'),
    payload: z.object({
      collections: z.array(z.object({
        name: z.string(),
        requestCount: z.number(),
        lastModified: z.string(),
      })),
      activeCollection: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('collection-loaded'),
    payload: z.object({
      collection: z.object({
        schema_version: z.string(),
        name: z.string(),
        version: z.string().optional(),
        description: z.string().optional(),
        requests: z.array(z.unknown()),
      }),
    }),
  }),
  z.object({
    type: z.literal('request-saved'),
    payload: z.object({
      collectionName: z.string(),
      request: z.unknown(),
    }),
  }),
  z.object({
    type: z.literal('request-deleted'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('history-loaded'),
    payload: z.object({
      entries: z.array(z.object({
        id: z.string(),
        requestId: z.string(),
        requestName: z.string(),
        method: z.string(),
        path: z.string(),
        status: z.number(),
        durationMs: z.number(),
        executedAt: z.string(),
      })),
    }),
  }),
  z.object({
    type: z.literal('workspace-state'),
    payload: z.object({
      initialized: z.boolean(),
      collections: z.array(z.object({
        name: z.string(),
        requestCount: z.number(),
        lastModified: z.string(),
      })),
      activeCollection: z.string().optional(),
    }),
  }),
  // Template/Faker/Preset/Environment messages (M204)
  z.object({
    type: z.literal('template-generated'),
    payload: z.object({
      body: z.unknown(),
      source: z.enum(['server', 'client']),
    }),
  }),
  z.object({
    type: z.literal('sample-generated'),
    payload: z.object({
      body: z.unknown(),
      source: z.enum(['server', 'client']),
    }),
  }),
  z.object({
    type: z.literal('presets-loaded'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
      presets: z.array(z.object({
        name: z.string(),
        body: z.unknown().optional(),
        source: z.enum(['manual', 'faker', 'imported']).optional(),
        seed: z.number().optional(),
      })),
    }),
  }),
  z.object({
    type: z.literal('environments-loaded'),
    payload: z.object({
      environments: z.array(z.object({
        name: z.string(),
        lastModified: z.string(),
      })),
      activeEnvironment: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('environment-loaded'),
    payload: z.object({
      environment: z.object({
        name: z.string(),
        variables: z.record(z.string(), z.string()),
      }),
    }),
  }),
  // Export/Import messages (M205)
  z.object({
    type: z.literal('export-complete'),
    payload: z.object({
      path: z.string(),
      itemCount: z.number(),
    }),
  }),
  z.object({
    type: z.literal('import-complete'),
    payload: z.object({
      collections: z.number(),
      environments: z.number(),
    }),
  }),
  z.object({
    type: z.literal('import-conflicts'),
    payload: z.object({
      conflicts: z.array(z.object({
        type: z.string(),
        name: z.string(),
        existingItemCount: z.number().optional(),
      })),
    }),
  }),
  // Batch Execution & Validation messages (M206)
  z.object({
    type: z.literal('batch-progress'),
    payload: z.object({
      current: z.number(),
      total: z.number(),
      requestName: z.string(),
    }),
  }),
  z.object({
    type: z.literal('batch-complete'),
    payload: z.object({
      total: z.number(),
      passed: z.number(),
      failed: z.number(),
      errors: z.number(),
      skipped: z.number(),
      totalDurationMs: z.number(),
      results: z.array(z.object({
        requestId: z.string(),
        requestName: z.string(),
        status: z.enum(['passed', 'failed', 'error', 'skipped']),
        responseStatus: z.number(),
        durationMs: z.number(),
        assertionsPassed: z.number(),
        assertionsTotal: z.number(),
        error: z.string().optional(),
      })),
    }),
  }),
  z.object({
    type: z.literal('validation-result'),
    payload: z.object({
      valid: z.number(),
      warnings: z.number(),
      errors: z.number(),
      diagnostics: z.array(z.object({
        path: z.string(),
        severity: z.enum(['error', 'warning', 'info']),
        message: z.string(),
      })),
    }),
  }),
  z.object({
    type: z.literal('keyboard-action'),
    payload: z.object({
      action: z.enum(['send', 'template', 'faker']),
    }),
  }),
]);

export const WebviewToExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
  }),
  z.object({
    type: z.literal('node-click'),
    payload: z.object({
      id: z.string(),
    }),
  }),
  z.object({
    type: z.literal('run-schematic-export'),
  }),
  z.object({
    type: z.literal('refresh-diagnostics'),
  }),
  // Sidebar messages
  z.object({
    type: z.literal('refresh-circuit'),
  }),
  z.object({
    type: z.literal('run-export'),
  }),
  z.object({
    type: z.literal('refresh-project-discovery'),
  }),
  z.object({
    type: z.literal('set-target-project'),
    payload: z.object({
      root: z.string()
    })
  }),
  z.object({
    type: z.literal('reveal-node'),
    payload: z.object({
      nodeId: z.string()
    })
  }),
  z.object({
    type: z.literal('insert-snippet'),
    payload: z.object({
      snippet: z.string()
    })
  }),
  z.object({
    type: z.literal('update-node-layout'),
    payload: z.object({
      nodeId: z.string(),
      x: z.number(),
      y: z.number()
    })
  }),
  z.object({
    type: z.literal('add-transition-node'),
    payload: z.object({
      label: z.string(),
      snippet: z.string(),
      x: z.number(),
      y: z.number()
    })
  }),
  z.object({
    type: z.literal('debug-resume'),
    payload: z.object({
      traceId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('debug-step'),
    payload: z.object({
      traceId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('debug-pause'),
    payload: z.object({
      traceId: z.string(),
    }),
  }),
  // API Explorer messages (M202)
  z.object({
    type: z.literal('fetch-routes'),
  }),
  z.object({
    type: z.literal('send-request'),
    payload: z.object({
      method: z.string(),
      path: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal('fetch-timeline'),
    payload: z.object({
      traceId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('direct-request'),
    payload: z.object({
      url: z.string(),
      method: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal('api-reveal-node'),
    payload: z.object({
      nodeId: z.string(),
    }),
  }),
  // Collection messages (M203)
  z.object({
    type: z.literal('load-collections'),
  }),
  z.object({
    type: z.literal('load-collection'),
    payload: z.object({
      name: z.string(),
    }),
  }),
  z.object({
    type: z.literal('save-request'),
    payload: z.object({
      collectionName: z.string(),
      request: z.unknown(),
    }),
  }),
  z.object({
    type: z.literal('delete-request'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('duplicate-request'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('rename-request'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
      newName: z.string(),
    }),
  }),
  z.object({
    type: z.literal('create-collection'),
    payload: z.object({
      name: z.string(),
    }),
  }),
  z.object({
    type: z.literal('delete-collection'),
    payload: z.object({
      name: z.string(),
    }),
  }),
  z.object({
    type: z.literal('load-history'),
    payload: z.object({
      limit: z.number().optional(),
    }),
  }),
  z.object({
    type: z.literal('init-workspace'),
  }),
  // Template/Faker/Preset/Environment messages (M204)
  z.object({
    type: z.literal('generate-template'),
    payload: z.object({
      method: z.string(),
      path: z.string(),
      schema: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal('generate-sample'),
    payload: z.object({
      method: z.string(),
      path: z.string(),
      schema: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal('save-preset'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
      preset: z.object({
        name: z.string(),
        body: z.unknown().optional(),
        source: z.enum(['manual', 'faker', 'imported']).optional(),
        seed: z.number().optional(),
      }),
    }),
  }),
  z.object({
    type: z.literal('delete-preset'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
      presetName: z.string(),
    }),
  }),
  z.object({
    type: z.literal('load-presets'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('load-environments'),
  }),
  z.object({
    type: z.literal('load-environment'),
    payload: z.object({
      name: z.string(),
    }),
  }),
  z.object({
    type: z.literal('save-environment'),
    payload: z.object({
      environment: z.object({
        name: z.string(),
        variables: z.record(z.string(), z.string()),
      }),
    }),
  }),
  z.object({
    type: z.literal('switch-environment'),
    payload: z.object({
      name: z.string(),
    }),
  }),
  // Export/Import messages (M205)
  z.object({
    type: z.literal('export-bundle'),
    payload: z.object({
      collectionNames: z.array(z.string()),
      environmentNames: z.array(z.string()),
      redactionStrategy: z.enum(['redact', 'strip', 'include']),
    }),
  }),
  z.object({
    type: z.literal('export-request'),
    payload: z.object({
      collectionName: z.string(),
      requestId: z.string(),
      includeResponse: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('import-file'),
  }),
  z.object({
    type: z.literal('resolve-conflicts'),
    payload: z.object({
      resolution: z.enum(['replace', 'skip']),
    }),
  }),
  // Batch Execution & Validation messages (M206)
  z.object({
    type: z.literal('batch-send'),
    payload: z.object({
      requestIds: z.array(z.string()),
    }),
  }),
  z.object({
    type: z.literal('batch-cancel'),
  }),
  z.object({
    type: z.literal('validate-body'),
    payload: z.object({
      body: z.unknown(),
      schema: z.unknown(),
    }),
  }),
]);

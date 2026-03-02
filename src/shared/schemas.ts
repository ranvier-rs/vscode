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
]);

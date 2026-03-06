import * as vscode from 'vscode';
import { WebSocket } from 'undici';
import type { ServerConnectionState, ExtensionToWebviewMessage, ApiEndpoint, ApiResponseData, ApiTimelineNode } from '../shared/types';
import type { CircuitPayload, RawSchematic } from './schematic';
import { parseCircuitPayload } from './schematic';

type ServerConnectionListener = (state: ServerConnectionState) => void;
type SchematicUpdateListener = (payload: CircuitPayload) => void;
type InspectorEventListener = (data: any) => void;

export class ServerConnectionManager implements vscode.Disposable {
  private ws: WebSocket | null = null;
  private state: ServerConnectionState = 'disconnected';
  private inspectorUrl: string;
  private pollTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private disposed = false;

  private readonly stateListeners: ServerConnectionListener[] = [];
  private readonly schematicListeners: SchematicUpdateListener[] = [];
  private readonly eventListeners: InspectorEventListener[] = [];

  private webview: vscode.Webview | null = null;

  constructor() {
    const config = vscode.workspace.getConfiguration('ranvier');
    this.inspectorUrl = config.get<string>('debugger.inspectorUrl', 'http://localhost:3000');
  }

  get connectionState(): ServerConnectionState {
    return this.state;
  }

  get url(): string {
    return this.inspectorUrl;
  }

  setWebview(webview: vscode.Webview | null) {
    this.webview = webview;
  }

  onStateChange(listener: ServerConnectionListener) {
    this.stateListeners.push(listener);
  }

  onSchematicUpdate(listener: SchematicUpdateListener) {
    this.schematicListeners.push(listener);
  }

  onInspectorEvent(listener: InspectorEventListener) {
    this.eventListeners.push(listener);
  }

  async connect(): Promise<void> {
    if (this.disposed) return;

    const config = vscode.workspace.getConfiguration('ranvier');
    this.inspectorUrl = config.get<string>('debugger.inspectorUrl', 'http://localhost:3000');

    this.setState('connecting');
    this.reconnectAttempt = 0;

    const reachable = await this.checkHealth();
    if (!reachable) {
      this.setState('error');
      this.scheduleReconnect();
      return;
    }

    this.connectWebSocket();
    this.setState('connected');
    await this.pollSchematic();
    this.startPolling();
  }

  disconnect(): void {
    this.stopPolling();
    this.clearReconnect();
    this.closeWebSocket();
    this.setState('disconnected');
  }

  private async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.inspectorUrl}/schematic`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async fetchSchematic(): Promise<CircuitPayload | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${this.inspectorUrl}/schematic`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const raw = await res.json() as RawSchematic;
      const payload = parseCircuitPayload(raw);
      return payload.nodes.length > 0 ? payload : null;
    } catch {
      return null;
    }
  }

  // Debug controls (formerly in DebuggerManager)
  async resume(traceId: string): Promise<void> {
    try {
      await fetch(`${this.inspectorUrl}/debug/resume/${traceId}`);
      this.postToWebview({ type: 'execution-resumed', payload: { traceId } });
    } catch (e) {
      console.error('Failed to resume trace', e);
    }
  }

  async step(traceId: string): Promise<void> {
    try {
      await fetch(`${this.inspectorUrl}/debug/step/${traceId}`);
      this.postToWebview({ type: 'execution-resumed', payload: { traceId } });
    } catch (e) {
      console.error('Failed to step trace', e);
    }
  }

  async pause(traceId: string): Promise<void> {
    try {
      await fetch(`${this.inspectorUrl}/debug/pause/${traceId}`);
    } catch (e) {
      console.error('Failed to pause trace', e);
    }
  }

  private connectWebSocket(): void {
    this.closeWebSocket();

    const wsUrl = this.inspectorUrl.replace(/^http/, 'ws') + '/events';
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data.toString());
          // Forward node_paused events to webview (existing debugger behavior)
          if (data.type === 'node_paused') {
            this.postToWebview({
              type: 'execution-paused',
              payload: {
                traceId: data.trace_id,
                nodeId: data.node_id,
              },
            });
          }
          // Forward metrics broadcast to webview
          if (data.type === 'metrics' && Array.isArray(data.circuits)) {
            this.postToWebview({
              type: 'metrics-update',
              payload: {
                circuits: data.circuits.map((c: any) => ({
                  circuit: c.circuit,
                  windowMs: c.window_ms,
                  nodes: Object.fromEntries(
                    Object.entries(c.nodes as Record<string, any>).map(([nodeId, m]: [string, any]) => [
                      nodeId,
                      {
                        throughput: m.throughput,
                        errorCount: m.error_count,
                        errorRate: m.error_rate,
                        latencyP50: m.latency_p50,
                        latencyP95: m.latency_p95,
                        latencyP99: m.latency_p99,
                        latencyAvg: m.latency_avg,
                        sampleCount: m.sample_count,
                      },
                    ])
                  ),
                })),
              },
            });
          }
          // Forward inspector lifecycle events (node_exit, circuit_exit, node_enter) to webview
          if (data.type === 'node_exit' || data.type === 'circuit_exit' || data.type === 'node_enter') {
            this.postToWebview({
              type: 'inspector-event',
              payload: {
                event: {
                  timestamp: data.timestamp ?? Date.now(),
                  eventType: data.type,
                  nodeId: data.node_id,
                  circuit: data.circuit,
                  durationMs: data.duration_ms,
                  outcomeType: data.outcome_type,
                },
              },
            });
          }
          // Forward stall detection events
          if (data.type === 'stall_detected' && Array.isArray(data.stalls)) {
            this.postToWebview({
              type: 'stall-detected',
              payload: {
                stalls: data.stalls.map((s: any) => ({
                  nodeId: s.node_id,
                  circuit: s.circuit,
                  stalledMs: s.stalled_ms,
                  thresholdMs: s.threshold_ms,
                })),
              },
            });
          }
          // Notify all event listeners
          for (const listener of this.eventListeners) {
            listener(data);
          }
        } catch (e) {
          console.error('Failed to parse inspector event', e);
        }
      };
      this.ws.onclose = () => {
        this.ws = null;
        if (!this.disposed && this.state === 'connected') {
          this.setState('error');
          this.scheduleReconnect();
        }
      };
      this.ws.onerror = (err) => {
        console.error('Inspector WebSocket error', err);
      };
    } catch (e) {
      console.error('Failed to connect to inspector WebSocket', e);
    }
  }

  private closeWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async pollSchematic(): Promise<void> {
    const payload = await this.fetchSchematic();
    if (payload) {
      for (const listener of this.schematicListeners) {
        listener(payload);
      }
    }
  }

  private startPolling(): void {
    this.stopPolling();
    const config = vscode.workspace.getConfiguration('ranvier');
    const intervalSec = config.get<number>('server.pollInterval', 10);
    this.pollTimer = setInterval(async () => {
      if (this.state !== 'connected') return;
      const reachable = await this.checkHealth();
      if (!reachable) {
        this.setState('error');
        this.stopPolling();
        this.closeWebSocket();
        this.scheduleReconnect();
        return;
      }
      await this.pollSchematic();
    }, intervalSec * 1000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    if (this.disposed) return;
    // Exponential backoff: 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempt), 30000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(async () => {
      if (this.disposed || this.state === 'connected') return;
      const reachable = await this.checkHealth();
      if (reachable) {
        this.connectWebSocket();
        this.setState('connected');
        this.reconnectAttempt = 0;
        await this.pollSchematic();
        this.startPolling();
      } else {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setState(newState: ServerConnectionState): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this.stateListeners) {
      listener(newState);
    }
    this.postToWebview({
      type: 'server-status',
      payload: { state: newState, url: this.inspectorUrl },
    });
  }

  private postToWebview(message: ExtensionToWebviewMessage): void {
    if (this.webview) {
      void this.webview.postMessage(message);
    }
  }

  // ── API Explorer Methods (M202) ──────────────────────────────────

  async fetchRoutes(): Promise<ApiEndpoint[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${this.inspectorUrl}/api/v1/routes`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return Array.isArray(data) ? data : (data.routes ?? []);
  }

  async relayRequest(payload: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<ApiResponseData> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    const res = await fetch(`${this.inspectorUrl}/api/v1/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json() as any;
    return {
      status: data.status ?? res.status,
      headers: data.headers ?? {},
      body: data.body ?? data,
      durationMs: data.duration_ms ?? 0,
      traceId: data.trace_id,
      contentType: data.headers?.['content-type'] ?? '',
    };
  }

  async fetchTimeline(traceId: string): Promise<ApiTimelineNode[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${this.inspectorUrl}/inspector/timeline/${traceId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json() as any;
    const events = Array.isArray(data) ? data : (data.events ?? []);
    return events.map((e: any) => ({
      nodeId: e.node_id ?? e.nodeId ?? '',
      label: e.label ?? e.node_id ?? '',
      durationMs: e.duration_ms ?? e.durationMs ?? 0,
      outcome: e.outcome_type === 'Fault' ? 'error' as const
        : e.outcome_type === 'Skip' ? 'skipped' as const
        : 'ok' as const,
      input: e.input,
      output: e.output,
    }));
  }

  // ── Schema / Sample Methods (M204) ─────────────────────────────

  async fetchSchema(method: string, path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${this.inspectorUrl}/api/v1/routes/schema`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, path }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  }

  async fetchSample(method: string, path: string, mode: 'empty' | 'random'): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${this.inspectorUrl}/api/v1/routes/sample`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, path, mode }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  }

  dispose(): void {
    this.disposed = true;
    this.stopPolling();
    this.clearReconnect();
    this.closeWebSocket();
  }
}

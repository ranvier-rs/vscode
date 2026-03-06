import type { WsConnectionState, WsLogEntry } from '../shared/types';

/**
 * WebSocket client for user-initiated WS connections in API Explorer (M216).
 * Separate from the Inspector connection in server-connection.ts.
 */
export class WsClient {
    private ws: WebSocket | null = null;
    private _state: WsConnectionState = 'disconnected';
    private _url = '';
    private _messageCount = 0;

    private readonly _onState: (state: WsConnectionState, url: string) => void;
    private readonly _onMessage: (entry: WsLogEntry) => void;

    constructor(
        onState: (state: WsConnectionState, url: string) => void,
        onMessage: (entry: WsLogEntry) => void,
    ) {
        this._onState = onState;
        this._onMessage = onMessage;
    }

    get state(): WsConnectionState { return this._state; }
    get url(): string { return this._url; }
    get messageCount(): number { return this._messageCount; }

    connect(url: string, subprotocols?: string[]) {
        this.disconnect();
        this._url = url;
        this._messageCount = 0;
        this._setState('connecting');

        try {
            this.ws = new WebSocket(url, subprotocols);
        } catch {
            this._setState('error');
            return;
        }

        this.ws.addEventListener('open', () => {
            this._setState('connected');
        });

        this.ws.addEventListener('message', (event) => {
            this._messageCount++;
            const data = typeof event.data === 'string' ? event.data : String(event.data);
            this._onMessage({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                direction: 'received',
                data,
                timestamp: new Date().toISOString(),
            });
        });

        this.ws.addEventListener('close', () => {
            this._setState('disconnected');
            this.ws = null;
        });

        this.ws.addEventListener('error', () => {
            this._setState('error');
        });
    }

    send(data: string) {
        if (!this.ws || this._state !== 'connected') return;
        this.ws.send(data);
        this._messageCount++;
        this._onMessage({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            direction: 'sent',
            data,
            timestamp: new Date().toISOString(),
        });
    }

    disconnect() {
        if (this.ws) {
            try { this.ws.close(); } catch { /* ignore */ }
            this.ws = null;
        }
        if (this._state !== 'disconnected') {
            this._setState('disconnected');
        }
    }

    private _setState(state: WsConnectionState) {
        this._state = state;
        this._onState(state, this._url);
    }
}

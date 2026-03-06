import type { WsConnectionState, SseEvent } from '../shared/types';

/**
 * SSE client for user-initiated Server-Sent Events connections in API Explorer (M216).
 * Uses native fetch with streaming response parsing.
 */
export class SseClient {
    private _controller: AbortController | null = null;
    private _state: WsConnectionState = 'disconnected';
    private _url = '';
    private _eventCount = 0;
    private _eventTypes = new Set<string>();

    private readonly _onState: (state: WsConnectionState, url: string) => void;
    private readonly _onEvent: (event: SseEvent) => void;

    constructor(
        onState: (state: WsConnectionState, url: string) => void,
        onEvent: (event: SseEvent) => void,
    ) {
        this._onState = onState;
        this._onEvent = onEvent;
    }

    get state(): WsConnectionState { return this._state; }
    get url(): string { return this._url; }
    get eventCount(): number { return this._eventCount; }
    get eventTypes(): string[] { return Array.from(this._eventTypes); }

    async connect(url: string, lastEventId?: string) {
        this.disconnect();
        this._url = url;
        this._eventCount = 0;
        this._eventTypes.clear();
        this._setState('connecting');

        this._controller = new AbortController();
        const headers: Record<string, string> = { 'Accept': 'text/event-stream' };
        if (lastEventId) {
            headers['Last-Event-ID'] = lastEventId;
        }

        try {
            const response = await fetch(url, {
                headers,
                signal: this._controller.signal,
            });

            if (!response.ok || !response.body) {
                this._setState('error');
                return;
            }

            this._setState('connected');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const events = this._parseSSE(buffer);
                buffer = events.remaining;

                for (const evt of events.parsed) {
                    this._eventCount++;
                    this._eventTypes.add(evt.eventType);
                    this._onEvent(evt);
                }
            }

            this._setState('disconnected');
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                this._setState('disconnected');
            } else {
                this._setState('error');
            }
        }
    }

    disconnect() {
        if (this._controller) {
            this._controller.abort();
            this._controller = null;
        }
        if (this._state !== 'disconnected') {
            this._setState('disconnected');
        }
    }

    private _parseSSE(buffer: string): { parsed: SseEvent[]; remaining: string } {
        const parsed: SseEvent[] = [];
        const blocks = buffer.split('\n\n');
        const remaining = blocks.pop() ?? '';

        for (const block of blocks) {
            if (!block.trim()) continue;

            let eventType = 'message';
            let data = '';
            let eventId: string | undefined;

            for (const line of block.split('\n')) {
                if (line.startsWith('event:')) {
                    eventType = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    data += (data ? '\n' : '') + line.slice(5).trim();
                } else if (line.startsWith('id:')) {
                    eventId = line.slice(3).trim();
                }
                // ignore retry: and comments (:)
            }

            if (data || eventType !== 'message') {
                parsed.push({
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    eventType,
                    data,
                    eventId,
                    timestamp: new Date().toISOString(),
                });
            }
        }

        return { parsed, remaining };
    }

    private _setState(state: WsConnectionState) {
        this._state = state;
        this._onState(state, this._url);
    }
}

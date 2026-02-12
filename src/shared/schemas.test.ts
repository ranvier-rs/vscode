import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    ExtensionToWebviewMessageSchema,
    WebviewToExtensionMessageSchema
} from './schemas';

describe('Shared Schemas', () => {
    describe('ExtensionToWebviewMessageSchema', () => {
        it('validates init message', () => {
            const msg = {
                type: 'init',
                payload: {
                    nodes: [{ id: 'n1', label: 'Node 1', position: { x: 0, y: 0 } }],
                    edges: [],
                    activeFile: '/path/to/file',
                    diagnosticsUpdatedAt: '2023-01-01T00:00:00Z',
                    locale: 'en'
                }
            };
            const result = ExtensionToWebviewMessageSchema.safeParse(msg);
            assert.ok(result.success);
            if (result.success) {
                assert.equal(result.data.type, 'init');
            }
        });

        it('validates highlight-by-file message', () => {
            const msg = {
                type: 'highlight-by-file',
                payload: { activeFile: '/path' }
            };
            const result = ExtensionToWebviewMessageSchema.safeParse(msg);
            assert.ok(result.success);
        });

        it('fails on invalid payload structure', () => {
            const msg = {
                type: 'highlight-by-file',
                payload: { activeFile: 123 } // Invalid type
            };
            const result = ExtensionToWebviewMessageSchema.safeParse(msg);
            assert.ok(!result.success);
        });

        it('fails on unknown message type', () => {
            const msg = {
                type: 'unknown-message',
                payload: {}
            };
            const result = ExtensionToWebviewMessageSchema.safeParse(msg);
            assert.ok(!result.success);
        });
    });

    describe('WebviewToExtensionMessageSchema', () => {
        it('validates ready message', () => {
            const msg = { type: 'ready' };
            const result = WebviewToExtensionMessageSchema.safeParse(msg);
            assert.ok(result.success);
        });

        it('validates node-click message', () => {
            const msg = {
                type: 'node-click',
                payload: { id: 'n1' }
            };
            const result = WebviewToExtensionMessageSchema.safeParse(msg);
            assert.ok(result.success);
        });

        it('validates set-target-project message', () => {
            const msg = {
                type: 'set-target-project',
                payload: { root: '/path/to/root' }
            };
            const result = WebviewToExtensionMessageSchema.safeParse(msg);
            assert.ok(result.success);
        });

        it('fails when payload is missing for messages requiring it', () => {
            const msg = {
                type: 'node-click'
                // missing payload
            };
            const result = WebviewToExtensionMessageSchema.safeParse(msg);
            assert.ok(!result.success);
        });
    });
});

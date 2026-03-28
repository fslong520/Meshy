import { describe, expect, it, vi } from 'vitest';
import { DaemonServer } from '../../../src/core/daemon/server.js';

describe('DaemonServer RPC routing', () => {
    it('routes harness and plugin RPC methods to dedicated events', () => {
        const daemon = new DaemonServer(0) as any;
        const ws = { readyState: 1, send: vi.fn() } as any;
        const emitted: Array<{ event: string; args: unknown[] }> = [];
        const originalEmit = daemon.emit.bind(daemon);
        daemon.emit = ((event: string, ...args: unknown[]) => {
            emitted.push({ event, args });
            return originalEmit(event, ...args);
        }) as typeof daemon.emit;

        daemon.handleClientMessage(ws, {
            id: '1',
            type: 'request',
            method: 'harness:fixture:create',
            params: { replayPath: '/tmp/replay.json' },
        });
        daemon.handleClientMessage(ws, {
            id: '2',
            type: 'request',
            method: 'plugin:list',
            params: {},
        });

        expect(emitted.some(entry => entry.event === 'harness:fixture:create')).toBe(true);
        expect(emitted.some(entry => entry.event === 'plugin:list')).toBe(true);
    });
});

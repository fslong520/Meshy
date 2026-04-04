import { describe, expect, it } from 'vitest';
import { normalizeAgentMessageEvent } from '../../../src/core/runtime/protocol.js';

describe('normalizeAgentMessageEvent', () => {
    it('maps tool call streaming events to runtime stream envelope', () => {
        const start = normalizeAgentMessageEvent({
            type: 'tool_call_start',
            data: { id: 'call-1', name: 'readFile' },
        });
        const delta = normalizeAgentMessageEvent({
            type: 'tool_call_chunk',
            data: '{"path":"src/index.ts"}',
        });
        const end = normalizeAgentMessageEvent({
            type: 'tool_call_end',
        });

        expect(start).toMatchObject({ type: 'tool_call_start', runtimeEventType: 'tool_call' });
        expect(delta).toMatchObject({ type: 'tool_call_delta', runtimeEventType: 'tool_call' });
        expect(end).toMatchObject({ type: 'tool_call_end', runtimeEventType: 'tool_call' });
    });

    it('maps done and error into runtime event-aligned stream kinds', () => {
        const done = normalizeAgentMessageEvent({ type: 'done' });
        const error = normalizeAgentMessageEvent({ type: 'error', data: 'boom' });

        expect(done).toMatchObject({ type: 'done', runtimeEventType: 'background_completion' });
        expect(error).toMatchObject({ type: 'error', runtimeEventType: 'interrupt', data: 'boom' });
    });

    it('preserves replace flag for text chunks', () => {
        const text = normalizeAgentMessageEvent({ type: 'text', data: 'hello', replace: true });
        expect(text).toMatchObject({ type: 'text', data: 'hello', replace: true });
    });
});

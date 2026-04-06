import { describe, expect, it } from 'vitest';
import { deriveReplayEvents } from '../../../src/shared/replay-event-derivation.js';

describe('shared replay event derivation', () => {
    it('appends policy decisions and keeps stable chronological ordering', () => {
        const derived = deriveReplayEvents(
            [
                {
                    type: 'agent:tool_call',
                    timestamp: '2026-04-06T00:00:01.000Z',
                    toolCallId: 'tool-call-1',
                    toolName: 'write_note',
                    argumentsText: '{"filePath":"a.txt"}',
                },
                {
                    type: 'agent:tool_result',
                    timestamp: '2026-04-06T00:00:02.000Z',
                    toolCallId: 'tool-call-1',
                    toolName: 'write_note',
                    content: 'blocked by policy',
                    isError: true,
                },
                {
                    type: 'agent:text',
                    timestamp: '2026-04-06T00:00:02.000Z',
                    role: 'assistant',
                    content: 'after tool result',
                },
            ],
            [
                {
                    id: 'tool-call-1',
                    tool: 'write_note',
                    decision: 'deny',
                    mode: 'read_only',
                    permissionClass: 'write',
                    reason: 'blocked by policy',
                    timestamp: '2026-04-06T00:00:03.000Z',
                },
            ],
        );

        expect(derived.map((event) => event.type)).toEqual([
            'agent:tool_call',
            'agent:tool_result',
            'agent:text',
            'agent:policy_decision',
        ]);
        expect(derived[3]).toMatchObject({
            type: 'agent:policy_decision',
            toolCallId: 'tool-call-1',
            toolName: 'write_note',
            decision: 'deny',
        });
    });
});

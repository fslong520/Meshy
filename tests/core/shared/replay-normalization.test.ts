import { describe, expect, it } from 'vitest';
import { normalizeReplayEvents } from '../../../src/shared/replay-normalization.js';

describe('shared replay normalization', () => {
    it('canonicalizes legacy replay event names and fills defaults', () => {
        const normalized = normalizeReplayEvents([
            {
                type: 'text',
                role: 'user',
                content: 'legacy text event',
            },
            {
                type: 'tool_call',
                timestamp: '2026-04-04T00:00:01.000Z',
                toolCallId: 'tool-call-1',
            },
            {
                type: 'tool_result',
                timestamp: '2026-04-04T00:00:02.000Z',
                toolCallId: 'tool-call-1',
                isError: 'yes',
            },
            {
                type: 'policy_decision',
                timestamp: '2026-04-04T00:00:03.000Z',
                toolCallId: 'tool-call-1',
                toolName: 'write_note',
            },
            null,
            'skip-me',
        ], {
            fallbackTimestamp: '2026-04-04T00:00:00.000Z',
        });

        expect(normalized).toEqual([
            {
                type: 'agent:text',
                timestamp: '2026-04-04T00:00:00.000Z',
                role: 'user',
                content: 'legacy text event',
            },
            {
                type: 'agent:tool_call',
                timestamp: '2026-04-04T00:00:01.000Z',
                toolCallId: 'tool-call-1',
                toolName: 'unknown_tool',
                argumentsText: '',
            },
            {
                type: 'agent:tool_result',
                timestamp: '2026-04-04T00:00:02.000Z',
                toolCallId: 'tool-call-1',
                toolName: 'unknown_tool',
                content: '',
                isError: true,
            },
            {
                type: 'agent:policy_decision',
                timestamp: '2026-04-04T00:00:03.000Z',
                toolCallId: 'tool-call-1',
                toolName: 'write_note',
                decision: 'allow',
                mode: 'standard',
                permissionClass: 'unknown',
                reason: '',
            },
        ]);
    });
});

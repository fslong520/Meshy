import { describe, expect, it } from 'vitest';
import { Session } from '../../../src/core/session/state.js';
import { exportReplay } from '../../../src/core/session/replay.js';

describe('replay policy decisions', () => {
    it('derives replay policy decisions from persisted tool-result metadata', () => {
        const session = new Session('session-policy-replay');
        session.addMessage({
            role: 'assistant',
            content: {
                type: 'tool_call',
                id: 'tool-call-1',
                name: 'write_note',
                arguments: { filePath: 'a.txt' },
            },
        });
        session.addMessage({
            role: 'user',
            content: {
                type: 'tool_result',
                id: 'tool-call-1',
                content: 'blocked by policy',
                isError: true,
                metadata: {
                    policyDecision: {
                        decision: 'deny',
                        mode: 'read_only',
                        permissionClass: 'write',
                        reason: 'blocked by policy',
                        timestamp: '2026-04-08T00:00:03.000Z',
                    },
                },
            },
            timestamp: '2026-04-08T00:00:05.000Z',
        });

        const replay = exportReplay(session);

        expect(replay.policyDecisions).toHaveLength(1);
        expect(replay.policyDecisions[0]?.tool).toBe('write_note');
        expect(replay.policyDecisions[0]?.decision).toBe('deny');
        expect(replay.policyDecisions[0]?.timestamp).toBe('2026-04-08T00:00:03.000Z');
        const toolResultStep = replay.steps.find((step) => step.type === 'tool_result');
        expect(toolResultStep).toBeDefined();
        expect((toolResultStep?.raw as { metadata?: { policyDecision?: { decision?: string } } })?.metadata?.policyDecision?.decision).toBe('deny');
        expect((toolResultStep?.raw as { isError?: boolean })?.isError).toBe(true);
        expect(toolResultStep?.timestamp).toBe('2026-04-08T00:00:05.000Z');
    });
});

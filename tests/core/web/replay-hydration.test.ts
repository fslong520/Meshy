import { describe, expect, it } from 'vitest';
import { hydrateReplayView } from '../../../web/src/store/replay-hydration.js';

describe('replay hydration', () => {
    it('hydrates tool policy badges and timeline from replay payloads', () => {
        const replay = {
            sessionId: 'session-1',
            totalSteps: 2,
            steps: [
                {
                    index: 0,
                    role: 'assistant',
                    type: 'tool_call',
                    summary: 'Tool: write_note({"filePath":"a.txt"})',
                    raw: {
                        type: 'tool_call',
                        id: 'tool-call-1',
                        name: 'write_note',
                        arguments: { filePath: 'a.txt' },
                    },
                },
                {
                    index: 1,
                    role: 'user',
                    type: 'tool_result',
                    summary: 'Result: blocked by policy',
                    raw: {
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
                            },
                        },
                    },
                },
            ],
            blackboard: {
                currentGoal: 'Keep audit context during replay',
                tasks: [],
            },
            policyDecisions: [
                {
                    id: 'tool-call-1',
                    tool: 'write_note',
                    decision: 'deny',
                    mode: 'read_only',
                    permissionClass: 'write',
                    reason: 'blocked by policy',
                    timestamp: '2026-04-04T00:00:00.000Z',
                },
            ],
        };

        const hydrated = hydrateReplayView(replay);

        expect(hydrated.messages).toHaveLength(1);
        expect(hydrated.messages[0]?.toolCalls).toHaveLength(1);
        expect(hydrated.messages[0]?.toolCalls?.[0]?.policyDecision?.decision).toBe('deny');
        expect(hydrated.messages[0]?.toolCalls?.[0]?.status).toBe('error');
        expect(hydrated.policyDecisions).toHaveLength(1);
        expect(hydrated.policyDecisions[0]?.permissionClass).toBe('write');
    });
});

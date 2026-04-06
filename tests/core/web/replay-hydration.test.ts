import { describe, expect, it } from 'vitest';
import type { ReplayExport } from '../../../src/shared/replay-contract.js';
import { hydrateReplayView } from '../../../web/src/store/replay-hydration.js';

describe('replay hydration', () => {
    it('hydrates tool policy badges and timeline from replay payloads', () => {
        const replay: ReplayExport = {
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

    it('prefers unified replay events when present', () => {
        const replay: ReplayExport = {
            sessionId: 'session-2',
            totalSteps: 1,
            steps: [
                {
                    index: 0,
                    role: 'user',
                    type: 'text',
                    summary: 'legacy hello',
                    raw: 'legacy hello',
                },
            ],
            events: [
                {
                    type: 'agent:text',
                    timestamp: '2026-04-04T00:00:00.000Z',
                    role: 'user',
                    content: 'hello from events',
                },
                {
                    type: 'agent:tool_call',
                    timestamp: '2026-04-04T00:00:01.000Z',
                    toolCallId: 'tool-call-2',
                    toolName: 'read_note',
                    argumentsText: '{"filePath":"note.md"}',
                },
                {
                    type: 'agent:tool_result',
                    timestamp: '2026-04-04T00:00:02.000Z',
                    toolCallId: 'tool-call-2',
                    toolName: 'read_note',
                    content: 'note contents',
                    isError: false,
                },
                {
                    type: 'agent:policy_decision',
                    timestamp: '2026-04-04T00:00:03.000Z',
                    toolCallId: 'tool-call-2',
                    toolName: 'read_note',
                    decision: 'allow',
                    mode: 'read_only',
                    permissionClass: 'read',
                    reason: 'allowed',
                },
            ],
            blackboard: {
                currentGoal: 'Use replay events',
                tasks: [],
            },
            policyDecisions: [],
        };

        const hydrated = hydrateReplayView(replay);

        expect(hydrated.messages).toHaveLength(2);
        expect(hydrated.messages[0]?.content).toBe('hello from events');
        expect(hydrated.messages[1]?.toolCalls?.[0]).toMatchObject({
            id: 'tool-call-2',
            name: 'read_note',
            result: 'note contents',
            status: 'done',
            policyDecision: {
                decision: 'allow',
                mode: 'read_only',
                permissionClass: 'read',
                reason: 'allowed',
            },
        });
        expect(hydrated.policyDecisions).toHaveLength(1);
        expect(hydrated.policyDecisions[0]?.tool).toBe('read_note');
    });

    it('supports legacy non-prefixed replay event names', () => {
        const replay: ReplayExport = {
            sessionId: 'session-legacy-events',
            totalSteps: 0,
            steps: [],
            events: [
                {
                    type: 'text',
                    timestamp: '2026-04-04T00:00:00.000Z',
                    role: 'user',
                    content: 'legacy event text',
                },
                {
                    type: 'tool_call',
                    timestamp: '2026-04-04T00:00:01.000Z',
                    toolCallId: 'tool-call-legacy',
                    toolName: 'read_note',
                    argumentsText: '{}',
                },
            ],
            blackboard: {
                currentGoal: 'legacy replay compatibility',
                tasks: [],
            },
            policyDecisions: [],
        };

        const hydrated = hydrateReplayView(replay);

        expect(hydrated.messages).toHaveLength(2);
        expect(hydrated.messages[0]?.content).toBe('legacy event text');
        expect(hydrated.messages[1]?.toolCalls?.[0]?.id).toBe('tool-call-legacy');
    });
});

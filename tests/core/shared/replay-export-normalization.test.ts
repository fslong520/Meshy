import { describe, expect, it } from 'vitest';
import { normalizeReplayExport } from '../../../src/shared/replay-export-normalization.js';

describe('shared replay export normalization', () => {
    it('fills default replay export fields and derives events when requested', () => {
        const normalized = normalizeReplayExport({
            sessionId: 'legacy-session',
            exportedAt: '2026-04-05T00:00:00.000Z',
            steps: [
                {
                    index: 0,
                    timestamp: '2026-04-05T00:00:00.000Z',
                    role: 'user',
                    type: 'text',
                    summary: 'hello',
                    raw: 'hello',
                },
            ],
            blackboard: {
                currentGoal: 'legacy goal',
            },
        }, {
            deriveEvents: (steps) => steps.map((step) => ({
                type: 'agent:text' as const,
                timestamp: step.timestamp,
                role: 'user' as const,
                content: step.summary,
            })),
        });

        expect(normalized.totalSteps).toBe(1);
        expect(normalized.events).toEqual([
            {
                type: 'agent:text',
                timestamp: '2026-04-05T00:00:00.000Z',
                role: 'user',
                content: 'hello',
            },
        ]);
        expect(normalized.runtimeDecisions).toEqual([]);
        expect(normalized.policyDecisions).toEqual([]);
        expect(normalized.metrics).toEqual({
            messageCountByRole: { system: 0, user: 0, assistant: 0, tool: 0 },
            textMessages: 0,
            toolCalls: 0,
            toolResults: 0,
            totalTextCharacters: 0,
            uniqueTools: [],
        });
        expect(normalized.blackboard).toEqual({
            currentGoal: 'legacy goal',
            tasks: [],
            openFiles: [],
            lastError: null,
        });
        expect(normalized.session).toEqual({
            title: undefined,
            status: 'active',
            activeAgentId: 'default',
            messageCount: 1,
        });
    });
});

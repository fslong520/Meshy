import { describe, expect, it } from 'vitest';
import { FixtureRecorder } from '../../../src/core/harness/fixtures/fixture-recorder.js';

describe('FixtureRecorder', () => {
    it('creates a replay-backed fixture from ReplayExport', async () => {
        const recorder = new FixtureRecorder();
        const fixture = await recorder.recordFromReplay({
            sessionId: 's-1',
            exportedAt: '2026-03-18T00:00:00.000Z',
            totalSteps: 1,
            steps: [],
            metrics: {
                messageCountByRole: { system: 0, user: 1, assistant: 0, tool: 0 },
                textMessages: 1,
                toolCalls: 0,
                toolResults: 0,
                totalTextCharacters: 5,
                uniqueTools: [],
            },
            blackboard: { currentGoal: 'ship harness', tasks: [], openFiles: [], lastError: null },
            session: { status: 'active', activeAgentId: 'default', messageCount: 1 },
        }, { title: 'Harness regression' });

        expect(fixture.schemaVersion).toBe(1);
        expect(fixture.sourceReplayId).toBe('s-1');
        expect(fixture.title).toBe('Harness regression');
        expect(fixture.goal).toBe('ship harness');
        expect(fixture.replay.sessionId).toBe('s-1');
    });
});

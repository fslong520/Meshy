import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessServerAdapter } from '../../../src/core/server/harness/adapter.js';

describe('HarnessServerAdapter', () => {
    it('creates fixtures from replay paths and returns persisted ids from real harness services', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-harness-adapter-'));
        const adapter = new HarnessServerAdapter(root);

        const replayPath = path.join(root, 'sample.replay.json');
        fs.writeFileSync(replayPath, JSON.stringify({
            sessionId: 's-1',
            exportedAt: '2026-03-18T00:00:00.000Z',
            totalSteps: 1,
            steps: [{ index: 0, timestamp: '2026-03-18T00:00:00.000Z', role: 'assistant', type: 'text', summary: 'done', raw: 'done' }],
            metrics: { messageCountByRole: { system: 0, user: 0, assistant: 1, tool: 0 }, textMessages: 1, toolCalls: 0, toolResults: 0, totalTextCharacters: 4, uniqueTools: [] },
            blackboard: { currentGoal: 'ship harness', tasks: [], openFiles: [], lastError: null },
            session: { status: 'active', activeAgentId: 'default', messageCount: 1 },
        }), 'utf8');

        const fixture = await adapter.createFixtureFromReplay(replayPath, { expected: { outputMarkers: ['done'] } });
        const result = await adapter.runFixture(fixture.fixtureId);

        expect(fixture.fixtureId).toBeTruthy();
        expect(result.runId).toBeTruthy();
        expect(result.reportId).toBeTruthy();
    });
});

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessArtifactStore } from '../../../src/core/harness/artifacts/artifact-store.js';
import { FixtureRecorder } from '../../../src/core/harness/fixtures/fixture-recorder.js';
import { EvaluationService } from '../../../src/core/harness/evaluation/evaluation-service.js';

describe('EvaluationService', () => {
    it('returns pass/fail, scores, attribution, and persisted report ids from a replay-backed fixture', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-eval-'));
        const store = new HarnessArtifactStore(root);
        const recorder = new FixtureRecorder();
        const service = new EvaluationService(store);
        const fixture = await recorder.recordFromReplay({
            sessionId: 's-1',
            exportedAt: '2026-03-18T00:00:00.000Z',
            totalSteps: 2,
            steps: [
                { index: 0, timestamp: '2026-03-18T00:00:00.000Z', role: 'assistant', type: 'tool_call', summary: 'Tool: readFile({})', raw: { type: 'tool_call', id: '1', name: 'readFile', arguments: {} } },
                { index: 1, timestamp: '2026-03-18T00:00:01.000Z', role: 'assistant', type: 'text', summary: 'done', raw: 'done' },
            ],
            metrics: { messageCountByRole: { system: 0, user: 0, assistant: 2, tool: 0 }, textMessages: 1, toolCalls: 1, toolResults: 0, totalTextCharacters: 4, uniqueTools: ['readFile'] },
            blackboard: { currentGoal: 'ship harness', tasks: [], openFiles: [], lastError: null },
            session: { status: 'active', activeAgentId: 'default', messageCount: 2 },
        }, { expected: { outputMarkers: ['done'], requiredTools: ['readFile'] } });

        const result = await service.runFixture(fixture);

        expect(result.status).toBe('passed');
        expect(result.reportId).toBeTruthy();
        expect(result.scores.outputMatch).toBe(1);
        expect(await store.loadRun(result.runId)).not.toBeNull();
        expect(await store.loadReport(result.reportId!)).not.toBeNull();
    });
});

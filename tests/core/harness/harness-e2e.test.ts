import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessArtifactStore } from '../../../src/core/harness/artifacts/artifact-store.js';
import { FixtureRecorder } from '../../../src/core/harness/fixtures/fixture-recorder.js';
import { EvaluationService } from '../../../src/core/harness/evaluation/evaluation-service.js';
import { FailureAttributor } from '../../../src/core/harness/attribution/failure-attributor.js';

describe('harness e2e', () => {
    it('covers replay to fixture to evaluation to attribution', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-harness-e2e-'));
        const store = new HarnessArtifactStore(root);
        const recorder = new FixtureRecorder();
        const attributor = new FailureAttributor();
        const service = new EvaluationService(store, attributor);

        const fixture = await recorder.recordFromReplay({
            sessionId: 's-fail',
            exportedAt: '2026-03-18T00:00:00.000Z',
            totalSteps: 1,
            steps: [
                { index: 0, timestamp: '2026-03-18T00:00:00.000Z', role: 'assistant', type: 'text', summary: 'not-done', raw: 'not-done' },
            ],
            metrics: { messageCountByRole: { system: 0, user: 0, assistant: 1, tool: 0 }, textMessages: 1, toolCalls: 0, toolResults: 0, totalTextCharacters: 8, uniqueTools: [] },
            blackboard: { currentGoal: 'ship harness', tasks: [], openFiles: [], lastError: null },
            session: { status: 'active', activeAgentId: 'default', messageCount: 1 },
        }, { expected: { outputMarkers: ['done'], requiredTools: ['readFile'] } });

        const result = await service.runFixture(fixture);

        expect(result.status).toBe('failed');
        expect(result.attribution).toBeTruthy();
        expect(result.attribution?.summary.length).toBeGreaterThan(0);
    });
});

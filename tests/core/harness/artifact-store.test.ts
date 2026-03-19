import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessArtifactStore } from '../../../src/core/harness/artifacts/artifact-store.js';

describe('HarnessArtifactStore', () => {
    it('persists fixtures, runs, and reports under .meshy/harness', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-harness-store-'));
        const store = new HarnessArtifactStore(root);

        await store.saveFixture({
            schemaVersion: 1,
            id: 'fx-1',
            title: 'fixture',
            sourceReplayId: 'r-1',
            createdAt: '2026-03-18T00:00:00.000Z',
            expected: {},
            replay: {
                sessionId: 'r-1',
                exportedAt: '2026-03-18T00:00:00.000Z',
                totalSteps: 0,
                steps: [],
                metrics: {
                    messageCountByRole: { system: 0, user: 0, assistant: 0, tool: 0 },
                    textMessages: 0,
                    toolCalls: 0,
                    toolResults: 0,
                    totalTextCharacters: 0,
                    uniqueTools: [],
                },
                blackboard: { currentGoal: '', tasks: [], openFiles: [], lastError: null },
                session: { status: 'active', activeAgentId: 'default', messageCount: 0 },
            },
        });

        await store.saveRun({
            schemaVersion: 1,
            id: 'run-1',
            fixtureId: 'fx-1',
            startedAt: '2026-03-18T00:00:00.000Z',
            status: 'passed',
            scores: { goalCompletion: 1, outputMatch: 1, toolUsageMatch: 1 },
        });

        await store.saveReport({
            schemaVersion: 1,
            id: 'rep-1',
            fixtureId: 'fx-1',
            runId: 'run-1',
            createdAt: '2026-03-18T00:00:01.000Z',
            status: 'passed',
            scores: { goalCompletion: 1, outputMatch: 1, toolUsageMatch: 1 },
            summary: 'ok',
        });

        expect(await store.loadFixture('fx-1')).not.toBeNull();
        expect(await store.loadRun('run-1')).not.toBeNull();
        expect(await store.loadReport('rep-1')).not.toBeNull();
    });
});

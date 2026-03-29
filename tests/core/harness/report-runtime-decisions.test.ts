import { describe, expect, it } from 'vitest';
import type { HarnessReport } from '../../../src/core/harness/artifacts/types.js';

describe('HarnessReport runtime decisions', () => {
    it('allows embedding replay runtime decisions directly in the report shape', () => {
        const report: HarnessReport = {
            schemaVersion: 1,
            id: 'rep-1',
            fixtureId: 'fx-1',
            runId: 'run-1',
            createdAt: '2026-03-29T00:00:00.000Z',
            status: 'passed',
            scores: { goalCompletion: 1, outputMatch: 1, toolUsageMatch: 1 },
            summary: 'ok',
            runtimeDecisions: [
                {
                    loopIndex: 0,
                    injectedSkills: ['debug-runtime'],
                    activeMcpServers: ['filesystem'],
                    reasonSummary: 'retrieved:debug-runtime',
                },
            ],
        };

        expect(report.runtimeDecisions[0].injectedSkills).toEqual(['debug-runtime']);
    });
});

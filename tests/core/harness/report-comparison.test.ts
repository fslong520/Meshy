import { describe, expect, it } from 'vitest';
import { compareHarnessReports } from '../../../src/core/harness/compare/report-comparison.js';

describe('compareHarnessReports', () => {
    it('combines status, score delta, runtime diff, and runtime attribution in one artifact', () => {
        const before = {
            status: 'passed',
            scores: { goalCompletion: 1, outputMatch: 0.8, toolUsageMatch: 1 },
            runtimeDecisions: [
                {
                    loopIndex: 0,
                    injectedSkills: ['debug-runtime'],
                    activeMcpServers: ['filesystem'],
                    reasonSummary: 'retrieved:debug-runtime',
                },
            ],
        };

        const after = {
            status: 'failed',
            scores: { goalCompletion: 0, outputMatch: 0.5, toolUsageMatch: 1 },
            runtimeDecisions: [
                {
                    loopIndex: 0,
                    injectedSkills: ['debug-runtime', 'fix-issue'],
                    activeMcpServers: ['filesystem', 'playwright'],
                    reasonSummary: 'retrieved:debug-runtime,fix-issue',
                },
            ],
        };

        const artifact = compareHarnessReports(before as any, after as any);

        expect(artifact).toEqual({
            beforeStatus: 'passed',
            afterStatus: 'failed',
            statusChanged: true,
            scoreDelta: {
                goalCompletion: -1,
                outputMatch: -0.30000000000000004,
                toolUsageMatch: 0,
            },
            runtimeDecisionDiff: {
                loopCountDelta: 0,
                loops: [
                    {
                        loopIndex: 0,
                        status: 'modified',
                        injectedSkillsAdded: ['fix-issue'],
                        injectedSkillsRemoved: [],
                        activeMcpAdded: ['playwright'],
                        activeMcpRemoved: [],
                        reasonChanged: true,
                        beforeReason: 'retrieved:debug-runtime',
                        afterReason: 'retrieved:debug-runtime,fix-issue',
                    },
                ],
            },
            runtimeAttribution: {
                type: 'mixed_shift',
                summary: 'Runtime behavior changed across multiple decision dimensions, including skill injection and MCP activation.',
            },
        });
    });
});

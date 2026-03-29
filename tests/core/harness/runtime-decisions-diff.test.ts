import { describe, expect, it } from 'vitest';
import { diffRuntimeDecisions } from '../../../src/core/harness/compare/runtime-decisions.js';

describe('diffRuntimeDecisions', () => {
    it('reports modified, added, and removed runtime decision loops', () => {
        const before = {
            runtimeDecisions: [
                {
                    loopIndex: 0,
                    injectedSkills: ['debug-runtime'],
                    activeMcpServers: ['filesystem'],
                    reasonSummary: 'retrieved:debug-runtime',
                },
                {
                    loopIndex: 1,
                    injectedSkills: ['review-pr'],
                    activeMcpServers: ['filesystem'],
                    reasonSummary: 'retrieved:review-pr',
                },
            ],
        };

        const after = {
            runtimeDecisions: [
                {
                    loopIndex: 0,
                    injectedSkills: ['debug-runtime', 'fix-issue'],
                    activeMcpServers: ['filesystem', 'playwright'],
                    reasonSummary: 'retrieved:debug-runtime,fix-issue',
                },
                {
                    loopIndex: 2,
                    injectedSkills: ['review-pr'],
                    activeMcpServers: ['filesystem'],
                    reasonSummary: 'retrieved:review-pr',
                },
            ],
        };

        const diff = diffRuntimeDecisions(before as any, after as any);

        expect(diff.loopCountDelta).toBe(0);
        expect(diff.loops).toEqual([
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
            {
                loopIndex: 1,
                status: 'removed',
                injectedSkillsAdded: [],
                injectedSkillsRemoved: ['review-pr'],
                activeMcpAdded: [],
                activeMcpRemoved: ['filesystem'],
                reasonChanged: true,
                beforeReason: 'retrieved:review-pr',
                afterReason: undefined,
            },
            {
                loopIndex: 2,
                status: 'added',
                injectedSkillsAdded: ['review-pr'],
                injectedSkillsRemoved: [],
                activeMcpAdded: ['filesystem'],
                activeMcpRemoved: [],
                reasonChanged: true,
                beforeReason: undefined,
                afterReason: 'retrieved:review-pr',
            },
        ]);
    });
});

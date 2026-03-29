import { describe, expect, it } from 'vitest';
import { attributeRuntimeDecisionDiff } from '../../../src/core/harness/compare/runtime-attribution.js';

describe('attributeRuntimeDecisionDiff', () => {
    it('classifies skill, MCP, reason, mixed, and unchanged diffs', () => {
        expect(attributeRuntimeDecisionDiff({ loopCountDelta: 0, loops: [] })).toEqual({
            type: 'none',
            summary: 'No material runtime decision difference was detected between the two reports.',
        });

        expect(attributeRuntimeDecisionDiff({
            loopCountDelta: 0,
            loops: [
                {
                    loopIndex: 0,
                    status: 'modified',
                    injectedSkillsAdded: ['fix-issue'],
                    injectedSkillsRemoved: [],
                    activeMcpAdded: [],
                    activeMcpRemoved: [],
                    reasonChanged: false,
                },
            ],
        } as any)).toEqual({
            type: 'skill_shift',
            summary: 'Runtime behavior changed mainly because the injected skill set changed between the two runs.',
        });

        expect(attributeRuntimeDecisionDiff({
            loopCountDelta: 0,
            loops: [
                {
                    loopIndex: 0,
                    status: 'modified',
                    injectedSkillsAdded: [],
                    injectedSkillsRemoved: [],
                    activeMcpAdded: ['playwright'],
                    activeMcpRemoved: [],
                    reasonChanged: false,
                },
            ],
        } as any)).toEqual({
            type: 'mcp_shift',
            summary: 'Runtime behavior changed mainly because the active MCP environment changed between the two runs.',
        });

        expect(attributeRuntimeDecisionDiff({
            loopCountDelta: 0,
            loops: [
                {
                    loopIndex: 0,
                    status: 'modified',
                    injectedSkillsAdded: [],
                    injectedSkillsRemoved: [],
                    activeMcpAdded: [],
                    activeMcpRemoved: [],
                    reasonChanged: true,
                },
            ],
        } as any)).toEqual({
            type: 'reason_shift',
            summary: 'Runtime selection reasoning changed while the visible capability sets stayed similar.',
        });

        expect(attributeRuntimeDecisionDiff({
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
                },
            ],
        } as any)).toEqual({
            type: 'mixed_shift',
            summary: 'Runtime behavior changed across multiple decision dimensions, including skill injection and MCP activation.',
        });
    });
});

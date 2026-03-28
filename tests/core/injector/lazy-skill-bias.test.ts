import { describe, expect, it, vi } from 'vitest';
import { LazyInjector } from '../../../src/core/injector/lazy.js';

describe('LazyInjector skill bias', () => {
    it('keeps explicit skills and uses preset-biased retrieval for supplemental hits', async () => {
        const skillRegistry = {
            listSkills: () => [
                {
                    name: 'debug-runtime',
                    description: 'Debug runtime behavior and failures',
                    keywords: ['debug', 'runtime'],
                    filePath: '/skills/debug/SKILL.md',
                    source: 'project',
                    tools: [{ name: 'debugTool', description: 'Debug tool', inputSchema: {} }],
                },
                {
                    name: 'review-pr',
                    description: 'Review pull requests',
                    keywords: ['review', 'pr'],
                    filePath: '/skills/review/SKILL.md',
                    source: 'project',
                    tools: [{ name: 'reviewTool', description: 'Review tool', inputSchema: {} }],
                },
            ],
            getSkill: (name: string) => ({
                name,
                description: name,
                keywords: [],
                filePath: `/skills/${name}/SKILL.md`,
                source: 'project',
                tools: [],
            }),
            getSkillBody: (name: string) => `Body for ${name}`,
        };

        const injector = new LazyInjector(
            skillRegistry as any,
            { listAgents: () => [], getAgent: () => null } as any,
            { getCatalog: () => ({ getAllEntries: () => [] }) } as any,
            { match: () => [], collectToolIds: () => [] } as any,
        );

        const parsed = {
            cleanText: 'debug production issue',
            skills: [{ value: 'explicit-skill' }],
            mentions: [],
        };
        const decision = { suggestedSkills: ['router-skill'] };
        const session = { history: [], setRagTools: vi.fn(), activeAgentId: 'default' };
        const providerResolver = {};

        const result = await injector.resolve(
            parsed as any,
            decision as any,
            'base prompt',
            session as any,
            providerResolver as any,
            process.cwd(),
        );

        expect(result.systemPrompt).toContain('Body for explicit-skill');
        expect(result.systemPrompt).toContain('Body for router-skill');
        expect(result.systemPrompt).toContain('Body for debug-runtime');
    });
});

import { describe, expect, it, vi } from 'vitest';
import { LazyInjector } from '../../../src/core/injector/lazy.js';

describe('LazyInjector per-loop skills', () => {
    it('does not imply carry-over between two separate loop resolutions', async () => {
        const skillRegistry = {
            listSkills: () => [
                { name: 'debug-runtime', description: 'Debug runtime issues', keywords: ['debug'], filePath: '/skills/debug/SKILL.md', source: 'project', tools: [] },
                { name: 'review-pr', description: 'Review pull requests', keywords: ['review'], filePath: '/skills/review/SKILL.md', source: 'project', tools: [] },
            ],
            getSkill: (name: string) => ({ name, description: name, keywords: [], filePath: `/skills/${name}/SKILL.md`, source: 'project', tools: [] }),
            getSkillBody: (name: string) => `Body for ${name}`,
        };

        const injector = new LazyInjector(
            skillRegistry as any,
            { listAgents: () => [], getAgent: () => null } as any,
            { getCatalog: () => ({ getAllEntries: () => [] }) } as any,
            { match: () => [], collectToolIds: () => [] } as any,
        );

        const session = { history: [], setRagTools: vi.fn(), activeAgentId: 'default' };

        const first = await injector.resolve(
            { cleanText: 'debug bug', skills: [], mentions: [] } as any,
            { suggestedSkills: [] } as any,
            'base prompt',
            session as any,
            {} as any,
            process.cwd(),
        );

        const second = await injector.resolve(
            { cleanText: 'review change', skills: [], mentions: [] } as any,
            { suggestedSkills: [] } as any,
            'base prompt',
            session as any,
            {} as any,
            process.cwd(),
        );

        expect(first.systemPrompt).toContain('Body for debug-runtime');
        expect(second.systemPrompt).toContain('Body for review-pr');
        expect(second.systemPrompt).not.toContain('Body for debug-runtime');
    });
});

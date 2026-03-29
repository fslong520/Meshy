import { describe, expect, it, vi } from 'vitest';
import { LazyInjector } from '../../../src/core/injector/lazy.js';

describe('InjectionResult metadata', () => {
    it('returns selectedSkills and a lightweight reason summary', async () => {
        const skillRegistry = {
            listSkills: () => [
                { name: 'debug-runtime', description: 'Debug runtime behavior', keywords: ['debug'], filePath: '/skills/debug/SKILL.md', source: 'project', tools: [] },
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

        const result = await injector.resolve(
            { cleanText: 'debug issue', skills: [{ value: 'explicit-skill' }], mentions: [] } as any,
            { suggestedSkills: ['router-skill'] } as any,
            'base prompt',
            { history: [], setRagTools: vi.fn(), activeAgentId: 'default' } as any,
            {} as any,
            process.cwd(),
        );

        expect(result.selectedSkills).toEqual(expect.arrayContaining(['explicit-skill', 'router-skill', 'debug-runtime']));
        expect(result.reasonSummary).toContain('explicit');
    });
});

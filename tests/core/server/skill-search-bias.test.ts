import { describe, expect, it } from 'vitest';
import { searchSkillsWithBias } from '../../../src/index.js';

describe('skill search bias integration', () => {
    it('biases skill search through the server search path without hiding skills from list/read semantics', () => {
        const registry = {
            listSkills: () => [
                {
                    name: 'debug-runtime',
                    description: 'Debug runtime behavior and failures',
                    keywords: ['debug', 'runtime'],
                    filePath: '/skills/debug/SKILL.md',
                    source: 'project',
                },
                {
                    name: 'review-pr',
                    description: 'Review pull requests',
                    keywords: ['review', 'pr'],
                    filePath: '/skills/review/SKILL.md',
                    source: 'project',
                },
            ],
        };
        const pluginAdapter = {
            getActiveCapabilities: () => ({
                skills: ['debug-runtime'],
            }),
        };

        const ranked = searchSkillsWithBias('debug production issue', registry as any, pluginAdapter as any);

        expect(ranked[0].name).toBe('debug-runtime');
        expect(ranked).toHaveLength(2);
    });
});

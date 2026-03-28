import { describe, expect, it } from 'vitest';
import { rankSkills } from '../../../src/core/skills/retrieval.js';

describe('rankSkills', () => {
    it('keeps clearly relevant skills above irrelevant skills even when bias exists', () => {
        const skills = [
            {
                name: 'debug-runtime',
                description: 'Debug runtime behavior and failures',
                keywords: ['debug', 'runtime'],
                filePath: '/skills/debug/SKILL.md',
                source: 'project',
            },
            {
                name: 'design-ui',
                description: 'Design user interface layouts',
                keywords: ['ui', 'design'],
                filePath: '/skills/ui/SKILL.md',
                source: 'project',
            },
        ];

        const ranked = rankSkills({
            query: 'debug runtime issue',
            skills: skills as any,
            bias: {
                preferredSkills: ['design-ui'],
                preferredKeywords: ['ui'],
            },
        });

        expect(ranked[0].skill.name).toBe('debug-runtime');
        expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    });
});

import { describe, expect, it } from 'vitest';
import { deriveSkillRetrievalBias } from '../../../src/core/plugins/runtime/skill-bias.js';

describe('deriveSkillRetrievalBias', () => {
    it('derives preferred skills from active capabilities and preserves explicit preferred keywords', () => {
        const bias = deriveSkillRetrievalBias({
            activeCapabilities: {
                skills: ['debug-runtime', 'fix-issue'],
                skillBias: {
                    preferredSkills: ['review-pr'],
                    preferredKeywords: ['debug', 'incident'],
                },
            },
        });

        expect(bias).toEqual({
            preferredSkills: ['debug-runtime', 'fix-issue', 'review-pr'],
            preferredKeywords: ['debug', 'incident'],
        });
    });
});

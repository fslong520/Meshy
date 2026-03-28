import type { SkillRetrievalBias } from '../../skills/retrieval.js';

export function deriveSkillRetrievalBias(input: {
    activeCapabilities: {
        skills?: string[];
        skillBias?: {
            preferredSkills?: string[];
            preferredKeywords?: string[];
        };
    };
}): SkillRetrievalBias {
    const preferredSkills = Array.from(new Set([
        ...(input.activeCapabilities.skills ?? []),
        ...(input.activeCapabilities.skillBias?.preferredSkills ?? []),
    ]));

    const preferredKeywords = Array.from(new Set(
        input.activeCapabilities.skillBias?.preferredKeywords ?? [],
    ));

    return {
        preferredSkills,
        preferredKeywords,
    };
}

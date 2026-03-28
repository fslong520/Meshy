import type { SkillMeta } from './registry.js';

export interface SkillRetrievalBias {
    preferredSkills: string[];
    preferredKeywords: string[];
}

export interface RankedSkill {
    skill: SkillMeta;
    score: number;
}

export function rankSkills(input: {
    query: string;
    skills: SkillMeta[];
    bias?: SkillRetrievalBias;
}): RankedSkill[] {
    const query = input.query.toLowerCase().trim();
    const tokens = query.length > 0 ? query.split(/\s+/) : [];

    return input.skills
        .map(skill => {
            const name = skill.name.toLowerCase();
            const description = skill.description.toLowerCase();
            const keywords = skill.keywords.map(keyword => keyword.toLowerCase());

            let baseScore = 0;
            for (const token of tokens) {
                if (name.includes(token)) baseScore += 4;
                if (description.includes(token)) baseScore += 2;
                if (keywords.some(keyword => keyword.includes(token))) baseScore += 3;
            }

            let biasScore = 0;
            if (baseScore > 0 && input.bias) {
                if (input.bias.preferredSkills.includes(skill.name)) {
                    biasScore += 2;
                }
                if (keywords.some(keyword => input.bias!.preferredKeywords.includes(keyword))) {
                    biasScore += 1;
                }
            }

            return {
                skill,
                score: baseScore + biasScore,
            };
        })
        .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
}

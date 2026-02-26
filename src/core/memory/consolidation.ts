import { ILLMProvider, StandardPrompt } from '../llm/provider.js';
import { MemoryStore } from './store.js';
import { getLogger } from '../logger/index.js';

export class MemoryConsolidationAgent {
    private provider: ILLMProvider;
    private memoryStore: MemoryStore;
    private isConsolidating: boolean = false;

    constructor(provider: ILLMProvider, memoryStore: MemoryStore) {
        this.provider = provider;
        this.memoryStore = memoryStore;
    }

    /**
     * Extracts recent knowledge and success patterns, and uses the LLM
     * to consolidate them into a long-term User Profile systemic prompt.
     * @param threshold Trigger consolidation only if there are at least `threshold` capsules total.
     */
    public async consolidate(threshold: number = 5): Promise<void> {
        if (this.isConsolidating) return;

        const logger = getLogger();

        try {
            this.isConsolidating = true;

            // Check if we have enough capsules to warrant a consolidation
            const recentCapsules = await this.memoryStore.getRecentCapsules(50);
            if (recentCapsules.length < threshold) {
                return;
            }

            // In a real production system we would keep track of last_consolidation_id
            // For MVP, we just take the top N capsules and rebuild
            logger.engine(`[Consolidation] Triggering memory consolidation with ${recentCapsules.length} rules...`);
            console.log(`\n[Memory Consolidation] Background process synthesizing long-term User Profile from ${recentCapsules.length} capsules...`);

            const currentProfile = await this.memoryStore.getUserProfile() || "No prior profile exists.";

            // Filter for valuable insights
            const insights = recentCapsules
                .filter(c => c.category === 'knowledge' || c.category === 'success_pattern')
                .map(c => `- ${c.summary}`)
                .join('\n');

            if (!insights.trim()) {
                return;
            }

            const promptText = `You are a Long-Term Memory Consolidator for an Agent OS.
Your goal is to merge newly discovered insights and patterns into the existing User Profile.
The User Profile acts as a foundational system prompt injected into every new agent context. It should capture the user's preferred technical stack, stylistic choices, and structural preferences.

### Existing User Profile:
${currentProfile}

### New Insights to Merge:
${insights}

### Instructions:
1. Output a unified, highly dense, concise markdown document blending the old and new profiles.
2. Group items logically (e.g., Tech Stack, Coding Preferences, Workflow Rules).
3. Always use bullet points instead of prose. DO NOT write conversational filler text like "Here is the updated profile".
4. If there are contradictory rules, prioritize the newer insights but try to gracefully merge them.
5. Max length: 400 words.`;

            const prompt: StandardPrompt = {
                systemPrompt: "You are the Memory Consolidation core. Output raw markdown profile.",
                messages: [{ role: 'user', content: promptText }]
            };

            let newProfile = '';
            await this.provider.generateResponseStream(prompt, (event) => {
                if (event.type === 'text') {
                    newProfile += event.data;
                }
            });

            if (newProfile.trim()) {
                await this.memoryStore.updateUserProfile(newProfile.trim());
                logger.engine(`[Consolidation] User Profile updated successfully. Length: ${newProfile.length} chars.`);
            }

        } catch (err) {
            console.error('[Memory Consolidation] Failed:', err);
        } finally {
            this.isConsolidating = false;
        }
    }
}

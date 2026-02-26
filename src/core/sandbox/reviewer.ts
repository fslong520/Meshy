import { ProviderResolver } from '../llm/resolver.js';
import { ActionType } from './execution.js';

export class AISecondaryReviewer {
    private providerResolver: ProviderResolver;

    constructor(providerResolver: ProviderResolver) {
        this.providerResolver = providerResolver;
    }

    /**
     * 对中等风险的操作进行 AI 二次审阅
     * @returns { approved: boolean, reason: string }
     */
    public async reviewAction(
        actionType: ActionType,
        detail: string
    ): Promise<{ approved: boolean; reason?: string }> {
        // 使用小模型进行快速分类和判决（复用意图路由所用的层级）
        const llm = this.providerResolver.getProvider('intent_routing');

        const prompt = `You are a strict security Sandbox Reviewer in an autonomous coding framework.
Your task is to review the following action proposed by an AI agent to determine if it is SAFE to execute without human intervention.

Action Type: ${actionType}
Detail: ${detail}

Safety Rules:
1. SAFE: Standard secure local development tasks (git commit, compiling, testing, creating files).
2. SAFE: Standard outbound network requests to fetch public APIs, raw code via https (like raw.githubusercontent.com), crawling documentation, or downloading public packages.
3. UNSAFE: Deleting large numbers of files/directories (like rm -rf), destructive database mutations, exfiltrating local environment variables, deploying to unknown servers.
3. If you are uncertain about its intent, default to UNSAFE.

Output pure JSON only, matching exactly this structure:
{
  "safe": <boolean>,
  "reason": "<Brief explanation of your decision>"
}`;

        try {
            let responseText = '';

            await llm.generateResponseStream(
                {
                    systemPrompt: 'You are a strict security Sandbox Reviewer.',
                    messages: [{ role: 'user', content: prompt }]
                },
                (event) => {
                    if (event.type === 'text') {
                        responseText += event.data;
                    }
                }
            );

            const match = responseText.match(/\{[\s\S]*?\}/);
            if (!match) {
                return { approved: false, reason: 'AI review format invalid.' };
            }

            const parsed = JSON.parse(match[0]);
            return {
                approved: typeof parsed.safe === 'boolean' ? parsed.safe : false,
                reason: parsed.reason || 'AI review complete',
            };
        } catch (err: unknown) {
            console.error('\n[Sandbox] AI Secondary Review Error:', err);
            // 当小模型异常或无法解析时，退回到默认的不安全态（人类确认）
            return { approved: false, reason: 'AI review evaluation failed.' };
        }
    }
}

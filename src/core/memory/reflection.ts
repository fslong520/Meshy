/**
 * Reflection Engine — 经验萃取与反馈飞轮 (EvoMap Capsule Generator)
 *
 * 职责：
 * 1. 在 Session 完成后，分析操作序列（修改了哪些文件、遇到了哪些错误、最终如何解决）
 * 2. 使用 LLM 将经验浓缩为结构化的知识胶囊 (Capsule)
 * 3. 写入 MemoryStore，供未来同类任务自动检索复用
 * 4. 响应用户点赞 (thumbs-up) / 踩 (thumbs-down) 反馈，分别打标为
 *    success_pattern 或 anti_pattern
 *
 * 核心机制：
 * - onSessionComplete Hook: 后台异步提取，不阻塞主流程
 * - onUserFeedback Hook: 实时将人工评价写入 DB
 * - 被动召回: TaskEngine 启动时从 MemoryStore 检索相关胶囊拼入 System Prompt
 */

import { ILLMProvider } from '../llm/provider.js';
import { Session } from '../session/state.js';
import { MemoryStore, Capsule } from '../memory/store.js';
import { MemoryConsolidationAgent } from './consolidation.js';

// ─── 反馈类型 ───
export type FeedbackType = 'thumbs_up' | 'thumbs_down';

// ─── 萃取请求 ───
export interface ReflectionRequest {
    session: Session;
    feedback?: FeedbackType;
}

// ─── 萃取结果 ───
export interface ReflectionResult {
    capsuleId: number;
    summary: string;
    tags: string[];
    category: Capsule['category'];
}

export class ReflectionEngine {
    private llm: ILLMProvider;
    private memoryStore: MemoryStore;

    constructor(llm: ILLMProvider, memoryStore: MemoryStore) {
        this.llm = llm;
        this.memoryStore = memoryStore;
    }

    /**
     * Hook: onSessionComplete
     *
     * 在 Session 完成后异步调用，提取经验胶囊。
     * 此函数不应抛出异常 — 萃取失败不能影响主流程。
     */
    public async onSessionComplete(request: ReflectionRequest): Promise<ReflectionResult | null> {
        try {
            const { session, feedback } = request;

            // 如果 Session 历史太短，跳过萃取
            if (session.history.length < 4) {
                return null;
            }

            const toolCalls = session.history.filter(m => typeof m.content !== 'string' && !Array.isArray(m.content) && m.content.type === 'tool_call');
            const errors = session.history.filter(m => typeof m.content === 'string' && m.content.includes('Error'));

            // 简单问答（无工具调用）跳过
            if (toolCalls.length === 0) {
                return null;
            }

            // 简单的一次性任务（只有一次工具调用且没报错）并且不是显式触发的 feedback，跳过
            if (toolCalls.length === 1 && errors.length === 0 && !feedback) {
                return null;
            }

            // 根据反馈决定分类
            const category = this.resolveCategory(feedback);

            // 构建萃取上下文：摘取关键操作序列
            const operationSummary = this.buildOperationSummary(session);

            // 调用 LLM 生成结构化摘要
            const extracted = await this.extractWithLLM(operationSummary, category);

            if (!extracted) return null;

            // 写入 MemoryStore
            const capsuleId = await this.memoryStore.addCapsule({
                sessionId: session.id,
                summary: extracted.summary,
                tags: extracted.tags,
                category,
            });

            console.log(`[Reflection] Capsule #${capsuleId} saved: "${extracted.summary.slice(0, 60)}..."`);

            // Phase 19: Trigger background memory consolidation
            const consolidator = new MemoryConsolidationAgent(this.llm, this.memoryStore);
            consolidator.consolidate(5).catch(err => {
                console.error('[Reflection] Background consolidation failed:', err);
            });

            return {
                capsuleId,
                summary: extracted.summary,
                tags: extracted.tags,
                category,
            };
        } catch (err) {
            console.error('[Reflection] Failed to extract capsule:', err);
            return null;
        }
    }

    /**
     * Hook: onUserFeedback
     *
     * 用户在完成任务后点赞或踩，直接将当前 Session 的经验标记并存入。
     * 点赞 → success_pattern（好操作永远保留）
     * 踩 → anti_pattern（作为反面教材永远录入 Prompt 库）
     */
    public async onUserFeedback(session: Session, feedback: FeedbackType): Promise<void> {
        await this.onSessionComplete({ session, feedback });
    }

    /**
     * 被动召回：检索与当前任务相关的历史经验胶囊。
     * 返回格式化的 Prompt 片段，可直接拼入 System Prompt。
     */
    public async recallRelevantCapsules(taskDescription: string, limit: number = 5): Promise<string> {
        const capsules = await this.memoryStore.searchCapsules(taskDescription, limit);

        if (capsules.length === 0) {
            return '';
        }

        const lines = capsules.map((c, i) => {
            const icon = c.category === 'anti_pattern' ? '⚠️' : '✅';
            return `${i + 1}. ${icon} [${c.category}] ${c.summary}`;
        });

        return [
            '--- Project Memory: Relevant Past Experiences ---',
            ...lines,
            '--- End of Project Memory ---',
        ].join('\n');
    }

    // ═══════════════════════════════════════════
    // Internal — 操作序列摘要构建
    // ═══════════════════════════════════════════

    private buildOperationSummary(session: Session): string {
        const parts: string[] = [];

        parts.push(`Session ID: ${session.id}`);
        parts.push(`Goal: ${session.blackboard.currentGoal || '(not set)'}`);
        parts.push(`Total messages: ${session.history.length}`);

        // 提取工具调用序列
        const toolCalls = session.history
            .filter(m => typeof m.content !== 'string' && !Array.isArray(m.content) && m.content.type === 'tool_call')
            .map(m => {
                const tc = m.content as { name: string; arguments: Record<string, unknown> };
                return `  - ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)})`;
            });

        if (toolCalls.length > 0) {
            parts.push(`Tool calls:\n${toolCalls.join('\n')}`);
        }

        // 提取错误信息
        const errors = session.history
            .filter(m => typeof m.content === 'string' && m.content.includes('Error'))
            .map(m => `  - ${(m.content as string).slice(0, 100)}`);

        if (errors.length > 0) {
            parts.push(`Errors encountered:\n${errors.join('\n')}`);
        }

        // 最后的 blackboard 状态
        if (session.blackboard.lastError) {
            parts.push(`Last error: ${session.blackboard.lastError}`);
        }

        // 提取当前的轻量级状态变更 (Git Diff snippet)
        try {
            const { execSync } = require('child_process');
            const diff = execSync('git diff HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
            if (diff && diff.trim().length > 0) {
                // 取前 2000 个字符防止超长截断上下文
                parts.push(`Code Changes (Diff):\n${diff.slice(0, 2000)}${diff.length > 2000 ? '\n...(truncated)' : ''}`);
            }
        } catch {
            // Ignore if git is not available or not a repo
        }

        return parts.join('\n');
    }

    // ═══════════════════════════════════════════
    // Internal — LLM 萃取
    // ═══════════════════════════════════════════

    private async extractWithLLM(
        operationSummary: string,
        category: Capsule['category']
    ): Promise<{ summary: string; tags: string[] } | null> {
        let responseText = '';

        try {
            await this.llm.generateResponseStream(
                {
                    systemPrompt: `You are a knowledge extraction agent. Given a session operation log, extract a concise reusable lesson.

Respond ONLY with a JSON object in this exact format:
{
  "summary": "A concise 1-2 sentence description of what was learned",
  "tags": ["tag1", "tag2", "tag3"]
}

Category context: "${category}"
- If "success_pattern": focus on WHAT worked well and WHY
- If "anti_pattern": focus on WHAT went wrong and HOW to avoid it
- If "knowledge": focus on the factual lesson learned`,
                    messages: [{ role: 'user', content: operationSummary }],
                },
                (event) => {
                    if (event.type === 'text') {
                        responseText += event.data;
                    }
                }
            );

            // 提取 JSON（容忍 LLM 输出中包含 markdown 代码块）
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const parsed = JSON.parse(jsonMatch[0]);
            return {
                summary: parsed.summary || '',
                tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            };
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════
    // Internal — 分类决策
    // ═══════════════════════════════════════════

    private resolveCategory(feedback?: FeedbackType): Capsule['category'] {
        if (feedback === 'thumbs_up') return 'success_pattern';
        if (feedback === 'thumbs_down') return 'anti_pattern';
        return 'knowledge';
    }
}

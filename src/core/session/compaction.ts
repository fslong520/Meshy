/**
 * CompactionAgent — 上下文智能压缩
 *
 * Phase 20 改进版：分层压缩策略
 *
 * 策略：
 *  Layer 1: Strip — 将 history 中已被 offload 的大型 tool_result 替换为极短指针
 *  Layer 2: Summarize — 用轻量模型总结旧消息
 *  Layer 3: Progress — 压缩后更新 .agent/progress.md
 *
 * 灵感来源：
 *  - OpenAI Harness Engineering: "给 Agent 一张地图，而非千页说明书"
 *  - Anthropic Effective Harnesses: claude-progress.txt 跨窗口记忆桥梁
 */

import { ILLMProvider, StandardMessage, StandardPrompt } from '../llm/provider.js';
import { Session } from './state.js';
import { getLogger } from '../logger/index.js';

// ─── 配置常量 ───
const COMPACTION_THRESHOLD = 40;  // 消息数超过此值时自动压缩（从 60 降至 40）
const KEEP_RECENT = 20;           // 保留最近 N 条消息（从 16 提升至 20）

/** Layer 1: 已 offloaded 的 tool result 的标识文本 */
const OFFLOAD_MARKER = 'Full output saved to:';

/** Layer 2: LLM 压缩的系统提示（提升至 300 词上限） */
const COMPACTION_SYSTEM_PROMPT = `You are a context compactor for an Agent system. Your goal is to compress the provided conversation history into concise, structured bullet points that preserve maximum actionable context.

Rules:
1. Use markdown bullet points. NO conversational filler. NO paragraphs.
2. Preserve ALL of the following (in order of priority):
   a. Key architectural/structural decisions made by the user or agent.
   b. The final status of each task (completed / in-progress / failed).
   c. File paths that were created, modified, or deleted.
   d. Confirmed user preferences and constraints.
   e. Error resolutions (what went wrong and how it was fixed).
3. For modified files, use format: "- Modified \`path/to/file\`: [what changed]".
4. For errors, use format: "- Error in [component]: [root cause] → [resolution]".
5. Do NOT include code blocks, full file contents, or verbose tool outputs.
6. Do NOT discard information about what the user explicitly asked for.
7. Max length: 300 words.`;

export class CompactionAgent {
    private provider: ILLMProvider;

    constructor(provider: ILLMProvider) {
        this.provider = provider;
    }

    /** 判断是否需要压缩 */
    shouldCompact(session: Session): boolean {
        return session.history.length > COMPACTION_THRESHOLD;
    }

    /** 执行分层压缩 */
    async compact(session: Session): Promise<void> {
        const logger = getLogger();
        const totalMessages = session.history.length;
        let cutIndex = totalMessages - KEEP_RECENT;

        if (cutIndex <= 0) return;

        // --- Safe Cut Boundary Logic ---
        // Retreat cutIndex to older messages if we landed in the middle of a tool interaction
        while (cutIndex > 0 && cutIndex < totalMessages) {
            const currentMsg = session.history[cutIndex];
            const prevMsg = session.history[cutIndex - 1];

            const prevIsToolCall = prevMsg.role === 'assistant' && typeof prevMsg.content === 'object' && prevMsg.content !== null && 'type' in prevMsg.content && prevMsg.content.type === 'tool_call';
            const currentIsToolResult = currentMsg.role === 'tool' || (typeof currentMsg.content === 'object' && currentMsg.content !== null && 'type' in currentMsg.content && currentMsg.content.type === 'tool_result');

            if (prevIsToolCall || currentIsToolResult) {
                cutIndex--;
            } else {
                break;
            }
        }

        if (cutIndex <= 0) {
            logger.warn('ENGINE', 'Could not find a safe boundary to split tool calls. Skipping compaction this turn to avoid corruption.');
            return;
        }

        const oldMessages = session.history.slice(0, cutIndex);
        const recentMessages = session.history.slice(cutIndex);

        logger.engine(`Compacting session: ${totalMessages} messages → summarizing ${oldMessages.length} old messages, keeping ${recentMessages.length} recent`);

        // ── Layer 1: Strip offloaded tool outputs ──
        const strippedMessages = this.stripOffloadedOutputs(oldMessages);

        // ── Layer 2: LLM Summarization ──
        const messagesForSummary = this.formatMessagesForSummary(strippedMessages);
        const prompt: StandardPrompt = {
            systemPrompt: COMPACTION_SYSTEM_PROMPT,
            messages: [
                { role: 'user', content: messagesForSummary },
            ],
        };

        let summary = '';
        await this.provider.generateResponseStream(prompt, (event) => {
            if (event.type === 'text') {
                summary += event.data;
            }
        });

        if (!summary.trim()) {
            logger.warn('ENGINE', 'Compaction produced empty summary, skipping');
            return;
        }

        // 替换历史：[压缩摘要] + 保留的最近消息
        const compactedMessage: StandardMessage = {
            role: 'assistant',
            content: `[Compacted Context — ${oldMessages.length} messages summarized]\n\n${summary}`,
        };

        session.history = [compactedMessage, ...recentMessages];
        logger.engine(`Compaction complete: ${totalMessages} → ${session.history.length} messages`);
    }

    /**
     * Layer 1: 将已被 offload 的 tool_result 内容替换为极短的文件指针。
     * 这大幅减少需要发送给 LLM 做摘要的文本量。
     */
    private stripOffloadedOutputs(messages: StandardMessage[]): StandardMessage[] {
        return messages.map(msg => {
            if (typeof msg.content === 'object' && msg.content !== null) {
                const obj = msg.content as unknown as Record<string, unknown>;
                if (obj.type === 'tool_result') {
                    const content = String(obj.content ?? '');
                    if (content.includes(OFFLOAD_MARKER)) {
                        // Extract just the file path line
                        const pathLine = content.split('\n').find(l => l.includes(OFFLOAD_MARKER));
                        return {
                            ...msg,
                            content: {
                                ...obj,
                                content: pathLine ?? '[Tool output was offloaded to file]',
                            } as unknown as string,
                        };
                    }
                }
            }
            return msg;
        });
    }

    /** 将消息列表格式化为可供总结的文本 */
    private formatMessagesForSummary(messages: StandardMessage[]): string {
        const lines: string[] = [];

        for (const msg of messages) {
            const role = msg.role.toUpperCase();
            if (typeof msg.content === 'string') {
                // 截断过长的单条消息
                const content = msg.content.length > 800
                    ? msg.content.slice(0, 800) + '...[truncated]'
                    : msg.content;
                lines.push(`[${role}]: ${content}`);
            } else if (msg.content && typeof msg.content === 'object') {
                const obj = msg.content as unknown as Record<string, unknown>;
                if (obj.type === 'tool_call') {
                    lines.push(`[${role}]: Called tool "${obj.name}" with args: ${JSON.stringify(obj.arguments).slice(0, 200)}`);
                } else if (obj.type === 'tool_result') {
                    const result = String(obj.content ?? '');
                    const truncated = result.length > 400
                        ? result.slice(0, 400) + '...[truncated]'
                        : result;
                    lines.push(`[TOOL_RESULT]: ${truncated}`);
                }
            }
        }

        return lines.join('\n');
    }
}

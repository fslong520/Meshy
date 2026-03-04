/**
 * CompactionAgent — 上下文自动压缩
 *
 * 当 Session 消息数超过阈值时，自动用轻量模型总结旧消息，
 * 防止 Token 窗口溢出。
 *
 * 策略：
 *  1. 保留最近 KEEP_RECENT 条消息不动
 *  2. 将更早的消息打包发送给轻量模型生成摘要
 *  3. 摘要替换掉原始旧消息
 */

import { ILLMProvider, StandardMessage, StandardPrompt } from '../llm/provider.js';
import { Session } from './state.js';
import { getLogger } from '../logger/index.js';

// ─── 配置常量 ───
const COMPACTION_THRESHOLD = 60;  // 消息数超过此值时自动压缩
const KEEP_RECENT = 16;           // 保留最近 N 条消息

const COMPACTION_SYSTEM_PROMPT = `You are a context compactor for an Agent system. Your goal is to drastically compress the provided conversation history into EXTREMELY concise bullet points.

Rules:
1. Use markdown bullet points. NO conversational filler. NO paragraphs.
2. Preserve key structural decisions, the final status of tasks, and confirmed user preferences.
3. If files were modified, just list "- File XYZ modified successfully". Do NOT include any code blocks.
4. If errors occurred, do NOT copy the error trace or lengthy logs. Just list "- Error in XYZ: resolution was ABC".
5. Max length of output is 150 words.`;

export class CompactionAgent {
    private provider: ILLMProvider;

    constructor(provider: ILLMProvider) {
        this.provider = provider;
    }

    /** 判断是否需要压缩 */
    shouldCompact(session: Session): boolean {
        return session.history.length > COMPACTION_THRESHOLD;
    }

    /** 执行压缩：总结旧消息并替换 */
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
                // Unsafe boundary, move backwards (reduce cutIndex) to keep this chain in the "recent" half
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

        // 构建压缩 prompt
        const messagesForSummary = this.formatMessagesForSummary(oldMessages);
        const prompt: StandardPrompt = {
            systemPrompt: COMPACTION_SYSTEM_PROMPT,
            messages: [
                { role: 'user', content: messagesForSummary },
            ],
        };

        // 收集总结结果
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

    /** 将消息列表格式化为可供总结的文本 */
    private formatMessagesForSummary(messages: StandardMessage[]): string {
        const lines: string[] = [];

        for (const msg of messages) {
            const role = msg.role.toUpperCase();
            if (typeof msg.content === 'string') {
                // 截断过长的单条消息
                const content = msg.content.length > 500
                    ? msg.content.slice(0, 500) + '...[truncated]'
                    : msg.content;
                lines.push(`[${role}]: ${content}`);
            } else if (msg.content && typeof msg.content === 'object') {
                const obj = msg.content as unknown as Record<string, unknown>;
                if (obj.type === 'tool_call') {
                    lines.push(`[${role}]: Called tool "${obj.name}" with args: ${JSON.stringify(obj.arguments).slice(0, 200)}`);
                } else if (obj.type === 'tool_result') {
                    const result = String(obj.content ?? '');
                    const truncated = result.length > 300
                        ? result.slice(0, 300) + '...[truncated]'
                        : result;
                    lines.push(`[TOOL_RESULT]: ${truncated}`);
                }
            }
        }

        return lines.join('\n');
    }
}

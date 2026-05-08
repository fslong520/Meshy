/**
 * OpenCodeDirectAdapter — OpenCode Zen 直连适配器
 *
 * 绕过 Vercel AI SDK @ai-sdk/openai-compatible，直接使用 fetch + SSE 流式解析。
 * 解决部分免费模型（big-pickle、hy3-preview-free 等）因 reasoning_content
 * 处理不当导致的 content 为空问题。
 *
 * 参考 OJBetter 项目的稳定实现方式：
 * https://github.com/fslong520/OJBetter
 */

import { ILLMProvider, StandardPrompt, AgentMessageEvent, StandardMessage } from './provider.js';

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

export class OpenCodeDirectAdapter implements ILLMProvider {
    private modelId: string;
    private apiKey: string;

    constructor(modelId: string, apiKey?: string) {
        this.modelId = modelId;
        this.apiKey = apiKey || '';
    }

    supportsEmbedding(): boolean {
        return false;
    }

    async listModelsAsync(): Promise<string[]> {
        try {
            const response = await fetch(`${ZEN_BASE_URL}/models`, {
                headers: this.apiKey
                    ? { 'Authorization': `Bearer ${this.apiKey}` }
                    : undefined,
            });
            if (response.ok) {
                const data = await response.json() as any;
                const modelsList = data.data || data.models;
                if (modelsList && Array.isArray(modelsList)) {
                    return modelsList.map((m: any) => m.id);
                }
            }
        } catch (err) {
            console.warn('[OpenCodeDirect] Failed to fetch models:', err instanceof Error ? err.message : err);
        }
        return [];
    }

    async generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        try {
            const messages = this.buildMessages(prompt);
            const body: Record<string, any> = {
                model: this.modelId,
                messages,
                stream: true,
                max_tokens: prompt.maxTokens ?? 8192,
                temperature: prompt.temperature ?? 0.3,
            };
            if (prompt.topP !== undefined) body.top_p = prompt.topP;
            if (prompt.tools && prompt.tools.length > 0) {
                body.tools = prompt.tools.map(t => ({
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.inputSchema,
                    },
                }));
                body.tool_choice = 'auto';
            }

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'User-Agent': 'Meshy/1.0',
            };
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            console.log('[OpenCodeDirect] Request:', {
                url: `${ZEN_BASE_URL}/chat/completions`,
                model: this.modelId,
            });

            const response = await fetch(`${ZEN_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: abortSignal,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = (errData as any).error?.message || `HTTP ${response.status}`;
                throw new Error(errMsg);
            }

            if (!response.body) {
                throw new Error('Response body is empty');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let toolCallsBuffer: any[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;

                        // 处理 thinking / reasoning_content（思考过程）
                        const reasoningDelta = delta.reasoning_content || delta.reasoning || '';
                        if (reasoningDelta) {
                            onEvent({ type: 'reasoning_chunk', data: reasoningDelta });
                        }

                        // 处理正文 content
                        const contentDelta = delta.content;
                        if (contentDelta) {
                            onEvent({ type: 'text', data: contentDelta });
                        }

                        const toolCallsDelta = delta.tool_calls;
                        if (toolCallsDelta && Array.isArray(toolCallsDelta)) {
                            for (const tc of toolCallsDelta) {
                                if (tc.function?.name) console.log(`[OpenCodeDirect] TOOL_CALL detected: name=${tc.function.name}, idx=${tc.index}`);
                                const idx = tc.index ?? 0;
                                while (toolCallsBuffer.length <= idx) {
                                    toolCallsBuffer.push({ id: '', name: '', arguments: '' });
                                }
                                const entry = toolCallsBuffer[idx];
                                if (tc.id) entry.id = tc.id;
                                if (tc.type) entry.type = tc.type;
                                if (tc.function) {
                                    if (tc.function.name) {
                                        entry.name = tc.function.name;
                                        onEvent({
                                            type: 'tool_call_start',
                                            data: { id: entry.id || `call-${idx}`, name: entry.name },
                                        });
                                    }
                                    if (tc.function.arguments) {
                                        entry.arguments += tc.function.arguments;
                                        onEvent({
                                            type: 'tool_call_chunk',
                                            data: tc.function.arguments,
                                        });
                                    }
                                }
                            }
                        }
                    } catch {
                        // Skip malformed JSON lines
                    }
                }
            }

            onEvent({ type: 'done' });
        } catch (err: any) {
            if (err.name === 'AbortError') {
                onEvent({ type: 'error', data: 'Request aborted' });
            } else {
                console.error('[OpenCodeDirect] Error:', err.message);
                onEvent({ type: 'error', data: err.message });
            }
            onEvent({ type: 'done' });
        }
    }

    /**
     * 将 StandardPrompt 转为 OpenAI 兼容的消息格式
     */
    private buildMessages(prompt: StandardPrompt): any[] {
        const messages: any[] = [];

        if (prompt.systemPrompt) {
            messages.push({ role: 'system', content: prompt.systemPrompt });
        }

        for (const msg of prompt.messages) {
            if (msg.role === 'system') continue; // Already handled above

            if (typeof msg.content === 'string') {
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: msg.content,
                });
            } else if (Array.isArray(msg.content)) {
                // Multi-part content (text + images) — simplified to just text
                const textParts = msg.content
                    .filter(p => p.type === 'text')
                    .map(p => p.text || '')
                    .join('\n');
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: textParts || '[non-text content]',
                });
            } else if ((msg.content as any)?.type === 'tool_call') {
                const tc = msg.content as any;
                messages.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: tc.id || `call-${Date.now()}`,
                        type: 'function',
                        function: {
                            name: tc.name || 'unknown',
                            arguments: typeof tc.arguments === 'string'
                                ? tc.arguments
                                : JSON.stringify(tc.arguments || {}),
                        },
                    }],
                });
            } else if ((msg.content as any)?.type === 'tool_result') {
                const tr = msg.content as any;
                messages.push({
                    role: 'tool',
                    tool_call_id: tr.id || '',
                    content: tr.content || '',
                });
            } else {
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: String(msg.content),
                });
            }
        }

        return messages;
    }
}

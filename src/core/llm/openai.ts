import OpenAI from 'openai';
import {
    AgentMessageEvent,
    ILLMProvider,
    StandardPrompt,
    StandardMessage,
    StandardToolCall,
    StandardToolResult
} from './provider.js';

// DeepSeek, Groq 等兼容 OpenAI 格式但不支持 embedding 端点的 Provider
const NON_EMBEDDING_PATTERNS = ['deepseek', 'groq', 'together', 'fireworks', 'mistral', 'perplexity'];

export class OpenAIAdapter implements ILLMProvider {
    private client: OpenAI;
    private modelName: string;
    private baseURL?: string;

    constructor(apiKey: string, modelName: string = 'gpt-4o', baseURL?: string) {
        this.client = new OpenAI({ apiKey, baseURL });
        this.modelName = modelName;
        this.baseURL = baseURL;
    }

    async generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (prompt.systemPrompt) {
            messages.push({ role: 'system', content: prompt.systemPrompt });
        }

        for (const msg of prompt.messages) {
            if (typeof msg.content === 'string') {
                if (msg.role === 'system') {
                    messages.push({ role: 'system', content: msg.content });
                } else {
                    const param: any = {
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: msg.content
                    };
                    // If it's an assistant message with previous reasoning, pass it back for context
                    if (msg.role === 'assistant' && (msg as any).reasoningContent) {
                        param.reasoning_content = (msg as any).reasoningContent;
                    }
                    messages.push(param);
                }
            } else if (Array.isArray(msg.content)) {
                const openaiContent: OpenAI.Chat.ChatCompletionContentPart[] = msg.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'text', text: part.text || '' };
                    } else if (part.type === 'image') {
                        let url = part.data || '';
                        if (!url.startsWith('data:')) {
                            url = `data:${part.mimeType || 'image/jpeg'};base64,${url}`;
                        }
                        return { type: 'image_url', image_url: { url } };
                    } else {
                        // For unsupported file types or plain text files, fallback to text representation
                        let decodedText = part.data || '';
                        if (part.data && !part.data.startsWith('data:')) {
                            try {
                                decodedText = Buffer.from(part.data, 'base64').toString('utf-8');
                            } catch (e) {
                                decodedText = '[Binary file omitted]';
                            }
                        } else if (part.data && part.data.startsWith('data:')) {
                            const commaIdx = part.data.indexOf(',');
                            if (commaIdx !== -1) {
                                try {
                                    decodedText = Buffer.from(part.data.substring(commaIdx + 1), 'base64').toString('utf-8');
                                } catch (e) {
                                    decodedText = '[Binary file omitted]';
                                }
                            }
                        }
                        return { type: 'text', text: `[Attached File: ${part.mimeType || 'unknown'}]\n${decodedText}` };
                    }
                });

                if (msg.role === 'user') {
                    messages.push({
                        role: 'user',
                        content: openaiContent
                    });
                } else {
                    messages.push({
                        role: 'assistant',
                        content: openaiContent.map(p => p.type === 'text' ? p.text : '').join('\n')
                    });
                }
            } else if (msg.content.type === 'tool_call') {
                messages.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: msg.content.id,
                        type: 'function',
                        function: {
                            name: msg.content.name,
                            arguments: JSON.stringify(msg.content.arguments)
                        }
                    }]
                });
            } else if (msg.content.type === 'tool_result') {
                messages.push({
                    role: 'tool',
                    tool_call_id: msg.content.id,
                    content: msg.content.content
                });
            }
        }

        const tools: OpenAI.Chat.ChatCompletionTool[] = (prompt.tools || []).map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema
            }
        }));

        try {
            const stream = await this.client.chat.completions.create({
                model: this.modelName,
                messages,
                tools: tools.length > 0 ? tools : undefined,
                stream: true,
            }, { signal: abortSignal });

            let currentToolCallId: string | undefined;
            let lastEmittedText = '';
            let isCumulativeStream: boolean | undefined = undefined;

            for await (const chunk of stream) {
                const choice = chunk.choices[0];
                if (!choice) continue;

                // Support for DeepSeek's reasoning_content
                const delta = choice.delta as any;
                if (delta.reasoning_content) {
                    onEvent({ type: 'reasoning_chunk', data: delta.reasoning_content });
                }

                if (choice.delta.content) {
                    const newText = choice.delta.content;

                    if (newText.length > 0) {
                        if (isCumulativeStream === undefined) {
                            if (lastEmittedText.length === 0) {
                                lastEmittedText = newText;
                                onEvent({ type: 'text', data: newText });
                                continue;
                            } else {
                                const cleanNew = newText.trim();
                                const cleanOld = lastEmittedText.trim();
                                if (cleanNew.length >= cleanOld.length && cleanOld.length >= 5 && cleanNew.startsWith(cleanOld.substring(0, 5))) {
                                    isCumulativeStream = true;
                                } else if (cleanNew !== cleanOld) {
                                    isCumulativeStream = false;
                                }
                            }
                        }

                        if (isCumulativeStream === true || isCumulativeStream === undefined) {
                            if (newText === lastEmittedText) {
                                continue;
                            } else {
                                // Robust cumulative handling: tell the frontend to replace the entire text
                                // This prevents duplicated prefixes caused by proxy formatting anomalies
                                onEvent({ type: 'text', data: newText, replace: true });
                                lastEmittedText = newText;
                            }
                        } else {
                            onEvent({ type: 'text', data: newText });
                            lastEmittedText += newText;
                        }
                    }
                }

                if (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) {
                    const toolCall = choice.delta.tool_calls[0];
                    if (toolCall.id) {
                        currentToolCallId = toolCall.id;
                        onEvent({ type: 'tool_call_start', data: { id: toolCall.id, name: toolCall.function?.name } });
                    }
                    if (toolCall.function?.arguments) {
                        onEvent({ type: 'tool_call_chunk', data: toolCall.function.arguments });
                    }
                }

                if (choice.finish_reason === 'tool_calls') {
                    if (currentToolCallId) {
                        onEvent({ type: 'tool_call_end' });
                        currentToolCallId = undefined;
                    }
                }

                if (choice.finish_reason === 'stop') {
                    onEvent({ type: 'done' });
                }
            }
        } catch (err: any) {
            onEvent({ type: 'error', data: err.message });
            throw err;
        }
    }

    supportsEmbedding(): boolean {
        // 只有原生 OpenAI API 支持 embedding，DeepSeek 等兼容 API 不支持
        if (!this.baseURL) return true;
        const url = this.baseURL.toLowerCase();
        return !NON_EMBEDDING_PATTERNS.some(p => url.includes(p));
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await this.client.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
        });
        return response.data[0].embedding;
    }

    async listModelsAsync(): Promise<string[]> {
        try {
            const list = await this.client.models.list();
            return list.data.map(m => m.id);
        } catch (err) {
            console.warn(`[OpenAIAdapter] Failed to list models:`, err instanceof Error ? err.message : err);
            return [];
        }
    }
}

import Anthropic from '@anthropic-ai/sdk';
import {
    AgentMessageEvent,
    ILLMProvider,
    StandardPrompt,
    StandardMessage,
    StandardToolCall,
    StandardToolResult
} from './provider.js';

export class AnthropicAdapter implements ILLMProvider {
    private client: Anthropic;
    private model: string;
    private originalBaseUrl: string | undefined;
    private apiKey: string;

    constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20240620', baseURL?: string) {
        // Anthropic SDK 会自内部追加 /v1/messages，
        // 如果配置的 baseURL 已经包含 /v1 后缀则需要去掉，避免 /v1/v1/messages 404。
        const normalizedBaseURL = baseURL?.replace(/\/v1\/?$/, '') || undefined;
        this.client = new Anthropic({ apiKey, baseURL: normalizedBaseURL });
        this.model = model;
        this.originalBaseUrl = baseURL;
        this.apiKey = apiKey;
    }

    async generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        const messages: Anthropic.MessageParam[] = [];

        // Map StandardMessage to Anthropic MessageParam
        for (const msg of prompt.messages) {
            if (msg.role === 'system') {
                // Handled below in top-level system parameter
                continue;
            }

            if (typeof msg.content === 'string') {
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: msg.content
                });
            } else if (Array.isArray(msg.content)) {
                const anthropicContent: Anthropic.ContentBlockParam[] = msg.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'text', text: part.text || '' };
                    } else if (part.type === 'image') {
                        let base64Data = part.data || '';
                        let mediaType = part.mimeType || 'image/jpeg';
                        if (base64Data.startsWith('data:')) {
                            const commaIdx = base64Data.indexOf(',');
                            if (commaIdx !== -1) {
                                const header = base64Data.substring(0, commaIdx);
                                const match = header.match(/^data:(image\/[a-zA-Z0-9+-.]+);base64/);
                                if (match) {
                                    mediaType = match[1];
                                }
                                base64Data = base64Data.substring(commaIdx + 1);
                            }
                        }
                        return {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                                data: base64Data
                            }
                        };
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

                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: anthropicContent
                });
            } else if (msg.content.type === 'tool_call') {
                messages.push({
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: msg.content.id,
                            name: msg.content.name,
                            input: msg.content.arguments
                        }
                    ]
                });
            } else if (msg.content.type === 'tool_result') {
                messages.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: msg.content.id,
                            content: msg.content.content
                        }
                    ]
                });
            }
        }

        const tools: Anthropic.Tool[] = (prompt.tools || []).map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema
        }));

        try {
            const stream = await this.client.messages.create({
                model: this.model,
                max_tokens: 4096,
                system: prompt.systemPrompt,
                messages,
                tools: tools.length > 0 ? tools : undefined,
                stream: true,
            }, { signal: abortSignal });

            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    onEvent({ type: 'text', data: chunk.delta.text });
                } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
                    onEvent({ type: 'tool_call_start', data: { id: chunk.content_block.id, name: chunk.content_block.name } });
                } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
                    onEvent({ type: 'tool_call_chunk', data: chunk.delta.partial_json });
                } else if (chunk.type === 'content_block_stop') {
                    // Tool or text block stop
                    onEvent({ type: 'tool_call_end' });
                } else if (chunk.type === 'message_stop') {
                    onEvent({ type: 'done' });
                }
            }
        } catch (err: any) {
            onEvent({ type: 'error', data: err.message });
            throw err;
        }
    }

    supportsEmbedding(): boolean {
        return false;
    }

    async listModelsAsync(): Promise<string[]> {
        // 尝试通过 HTTP 请求 /v1/models 获取动态模型列表（适用于 OpenAI 兼容代理）
        if (this.originalBaseUrl) {
            try {
                const modelsUrl = this.originalBaseUrl.replace(/\/$/, '') + '/models';
                const response = await fetch(modelsUrl, {
                    headers: { 
                        'Authorization': `Bearer ${this.apiKey}`,
                        'x-api-key': this.apiKey
                    },
                });
                if (response.ok) {
                    const data = await response.json() as { data?: Array<{ id: string }>, models?: Array<{ id: string }> };
                    const modelsList = data.data || data.models;
                    if (modelsList && Array.isArray(modelsList)) {
                        return modelsList.map(m => m.id);
                    }
                }
            } catch (err) {
                console.warn('[AnthropicAdapter] Failed to fetch models from custom endpoint:', err instanceof Error ? err.message : err);
            }
        }
        return [];
    }
}

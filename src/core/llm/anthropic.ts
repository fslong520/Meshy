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

    constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20240620', baseURL?: string) {
        // Anthropic SDK 会自内部追加 /v1/messages，
        // 如果配置的 baseURL 已经包含 /v1 后缀则需要去掉，避免 /v1/v1/messages 404。
        const normalizedBaseURL = baseURL?.replace(/\/v1\/?$/, '') || undefined;
        this.client = new Anthropic({ apiKey, baseURL: normalizedBaseURL });
        this.model = model;
    }

    async generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void
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
            });

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

    async generateEmbedding(_text: string): Promise<number[]> {
        // 返回全 0 向量，触发后续的 Keyword Search 降级而非直接阻断应用启动
        console.log('[AnthropicAdapter] Anthropic API does not provide text embeddings. Returning dummy vector to trigger keyword fallback.');
        return new Array(1536).fill(0);
    }
}

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

    constructor(apiKey: string) {
        this.client = new Anthropic({ apiKey });
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
                model: 'claude-3-5-sonnet-20240620',
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
}

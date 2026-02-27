import OpenAI from 'openai';
import {
    AgentMessageEvent,
    ILLMProvider,
    StandardPrompt,
    StandardMessage,
    StandardToolCall,
    StandardToolResult
} from './provider.js';

export class OpenAIAdapter implements ILLMProvider {
    private client: OpenAI;
    private modelName: string;

    constructor(apiKey: string, modelName: string = 'gpt-4o', baseURL?: string) {
        this.client = new OpenAI({ apiKey, baseURL });
        this.modelName = modelName;
    }

    async generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void
    ): Promise<void> {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (prompt.systemPrompt) {
            messages.push({ role: 'system', content: prompt.systemPrompt });
        }

        for (const msg of prompt.messages) {
            if (typeof msg.content === 'string') {
                if (msg.role === 'system') {
                    messages.push({ role: 'system', content: msg.content });
                } else if (msg.role === 'assistant') {
                    messages.push({ role: 'assistant', content: msg.content });
                } else {
                    messages.push({ role: 'user', content: msg.content });
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
            });

            let currentToolCallId: string | undefined;

            for await (const chunk of stream) {
                const choice = chunk.choices[0];
                if (!choice) continue;

                if (choice.delta.content) {
                    onEvent({ type: 'text', data: choice.delta.content });
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
        return true;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await this.client.embeddings.create({
            model: this.modelName,
            input: text,
            dimensions: 1536
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

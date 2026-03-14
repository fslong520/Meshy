import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, ModelMessage, tool, jsonSchema } from 'ai';
import {
    AgentMessageEvent,
    ILLMProvider,
    StandardPrompt,
} from './provider.js';

// Some providers don't natively support embeddings
const NON_EMBEDDING_PATTERNS = ['deepseek', 'groq', 'together', 'fireworks', 'mistral', 'perplexity'];

const BUNDLED_PROVIDERS: Record<string, (options: any) => any> = {
    'openai': createOpenAI,
    '@ai-sdk/openai': createOpenAI,
    'anthropic': createAnthropic,
    '@ai-sdk/anthropic': createAnthropic,
};

export class VercelAIAdapter implements ILLMProvider {
    private sdkIdentifier: string;
    private apiKey: string;
    private baseURL?: string;
    private modelId: string;
    private model: any;

    constructor(
        sdkIdentifier: string,
        apiKey: string,
        modelId: string,
        baseURL?: string
    ) {
        this.sdkIdentifier = sdkIdentifier;
        this.apiKey = apiKey;
        this.modelId = modelId;
        this.baseURL = baseURL;

        const factory = BUNDLED_PROVIDERS[sdkIdentifier];
        if (factory) {
            let normalizedBaseURL = baseURL;
            if (sdkIdentifier.includes('anthropic')) {
                normalizedBaseURL = baseURL?.replace(/\/v1\/?$/, '') || undefined;
            }

            const sdk = factory({
                apiKey,
                baseURL: normalizedBaseURL,
                headers: { 'x-api-key': apiKey }
            });
            this.model = sdk(modelId);
        } else {
            // Fallback: 尝试作为 openai 兼容层处理 (许多中转站支持 openai sdk)
            console.warn(`[VercelAIAdapter] SDK "${sdkIdentifier}" not explicitly bundled. Falling back to OpenAI compatibility mode.`);
            const openai = createOpenAI({
                apiKey,
                baseURL,
                headers: { 'x-api-key': apiKey }
            });
            this.model = openai(modelId);
        }
    }

    async generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        const messages: ModelMessage[] = [];

        for (const msg of prompt.messages) {
            if (msg.role === 'system') continue; // Handled top-level in streamText

            if (typeof msg.content === 'string') {
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: msg.content
                });
            } else if (Array.isArray(msg.content)) {
                const parts: any[] = [];
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        parts.push({ type: 'text', text: part.text || '' });
                    } else if (part.type === 'image') {
                        let url = part.data || '';
                        if (url.startsWith('data:')) {
                            // Extract base64 part for AI SDK native conversion
                            const commaIdx = url.indexOf(',');
                            if (commaIdx !== -1) {
                                url = url.substring(commaIdx + 1);
                            }
                        }
                        parts.push({ type: 'image', image: url }); // AI SDK auto decodes base64 or URL
                    } else {
                        // File fallback
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
                        parts.push({ type: 'text', text: `[Attached File: ${part.mimeType || 'unknown'}]\n${decodedText}` });
                    }
                }

                messages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: parts as any
                });
            } else if (msg.content.type === 'tool_call') {
                messages.push({
                    role: 'assistant',
                    content: [{
                        toolCallId: msg.content.id,
                        toolName: msg.content.name,
                        args: msg.content.arguments
                    } as any]
                });
            } else if (msg.content.type === 'tool_result') {
                messages.push({
                    role: 'tool',
                    content: [{
                        type: 'tool-result',
                        toolCallId: msg.content.id,
                        toolName: 'unknown',
                        result: msg.content.content
                    } as any]
                });
            }
        }

        const tools: Record<string, any> = {};
        if (prompt.tools && prompt.tools.length > 0) {
            for (const t of prompt.tools) {
                tools[t.name] = tool({
                    description: t.description,
                    // Use jsonSchema to adapt the raw JSON Schema without Zod compiling
                    parameters: jsonSchema<any>(t.inputSchema)
                } as any);
            }
        }

        try {
            const result = streamText({
                model: this.model,
                messages,
                system: prompt.systemPrompt,
                tools: Object.keys(tools).length > 0 ? tools : undefined,
                abortSignal
            } as any);

            for await (const chunk of result.fullStream) {
                const c = chunk as any;
                if (c.type === 'text-delta') {
                    onEvent({ type: 'text', data: c.textDelta });
                } else if (c.type === 'tool-call-streaming-start') {
                    onEvent({ type: 'tool_call_start', data: { id: c.toolCallId, name: c.toolName } });
                } else if (c.type === 'tool-call-delta') {
                    onEvent({ type: 'tool_call_chunk', data: c.argsTextDelta });
                } else if (c.type === 'tool-call') {
                    // tool-call-streaming events cover streaming, but if the provider only returns full chunk
                    // ai sdk will fire tool-call directly or at the end. We handle stream-end.
                    if (c.args) {
                        onEvent({ type: 'tool_call_start', data: { id: c.toolCallId, name: c.toolName } });
                        onEvent({ type: 'tool_call_chunk', data: JSON.stringify(c.args) });
                    }
                    onEvent({ type: 'tool_call_end' });
                } else if (c.type === 'step-finish' || c.type === 'finish') {
                    // Finalization
                } else if (c.type === 'error') {
                    onEvent({ type: 'error', data: String(c.error) });
                }
            }

            onEvent({ type: 'done' });
        } catch (err: any) {
            onEvent({ type: 'error', data: err.message });
            throw err;
        }
    }

    supportsEmbedding(): boolean {
        if (!this.baseURL) return true;
        const url = this.baseURL.toLowerCase();
        return !NON_EMBEDDING_PATTERNS.some(p => url.includes(p));
    }

    async generateEmbedding(text: string): Promise<number[]> {
        // AI SDK supports text embeddings, but we can stick to native fetch or local.
        // For simplicity, returning empty or throwing if natively required, 
        // usually resolver falls back to local WASM embedding.
        throw new Error("Vercel AI SDK integration currently relies on LocalEmbedding fallback for vectors.");
    }

    async listModelsAsync(): Promise<string[]> {
        if (this.baseURL) {
            try {
                const modelsUrl = this.baseURL.replace(/\/v1\/?$/, '') + '/v1/models';
                const response = await fetch(modelsUrl, {
                    headers: { 'Authorization': `Bearer ${this.apiKey}`, 'x-api-key': this.apiKey },
                });
                if (response.ok) {
                    const data = await response.json() as any;
                    const modelsList = data.data || data.models;
                    if (modelsList && Array.isArray(modelsList)) {
                        return modelsList.map((m: any) => m.id);
                    }
                }
            } catch (err) {
                console.warn('[VercelAIAdapter] Failed to fetch models from custom endpoint:', err instanceof Error ? err.message : err);
            }
        }
        return [];
    }
}

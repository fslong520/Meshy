import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, generateText, ModelMessage, tool } from 'ai';
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
    'deepseek': createDeepSeek,
    '@ai-sdk/deepseek': createDeepSeek,
    // 通用 OpenAI 兼容层（适用于 /v1/chat/completions 而非 /v1/responses）
    '@ai-sdk/openai-compatible': createOpenAICompatible,
    'openai-compatible': createOpenAICompatible,
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
        this.apiKey = apiKey || '';
        this.modelId = modelId;
        this.baseURL = baseURL;

        const factory = BUNDLED_PROVIDERS[sdkIdentifier];
        if (factory) {
            const isCodexProxy = !!baseURL && (baseURL.includes('openai-codex-oauth') || baseURL.includes('127.0.0.1:8317'));
            const normalizedBaseURL = (sdkIdentifier.includes('anthropic') && !isCodexProxy)
                ? baseURL?.replace(/\/v1\/?$/, '')
                : baseURL;

            // 对于不需要 API Key 的免费模型，不传递 apiKey
            const factoryOptions: Record<string, any> = {
                baseURL: normalizedBaseURL,
            };
            if (this.apiKey && !this.apiKey.startsWith('no-key') && this.apiKey !== 'placeholder') {
                factoryOptions.apiKey = this.apiKey;
            }
            if (isCodexProxy && this.apiKey) {
                factoryOptions.headers = { 'X-API-Key': this.apiKey, 'x-api-key': this.apiKey };
            }

            const sdk = factory(factoryOptions);
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
        const toolNameById = new Map<string, string>();
        const safeString = (value: unknown): string => {
            if (typeof value === 'string') return value;
            if (value === null || value === undefined) return '';
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        };
        const normalizeToolArgs = (args: unknown): Record<string, any> => {
            if (args === null || args === undefined) return {};
            if (typeof args === 'string') {
                try {
                    const parsed = JSON.parse(args);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
                    return { value: parsed };
                } catch {
                    return { raw: args };
                }
            }
            if (typeof args === 'object') {
                if (Array.isArray(args)) return { value: args };
                return args as Record<string, any>;
            }
            return { value: args };
        };
        const normalizeToolOutput = (output: unknown): { type: 'text' | 'json'; value: any } => {
            if (typeof output === 'string') return { type: 'text', value: output };
            if (output === null || output === undefined) return { type: 'text', value: '' };
            return { type: 'json', value: output };
        };
        const pushTextMessage = (role: 'user' | 'assistant', text: string) => {
            messages.push({ role, content: text });
        };

        for (const msg of prompt.messages) {
            if (msg.role === 'system') continue; // Handled top-level in streamText

            if (typeof msg.content === 'string') {
                const role = msg.role === 'assistant' ? 'assistant' : 'user';
                pushTextMessage(role, msg.content);
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
                const callId = safeString(msg.content.id) || `call-${Date.now()}`;
                const toolName = safeString(msg.content.name) || 'unknown';
                toolNameById.set(callId, toolName);
                const args = normalizeToolArgs(msg.content.arguments);
                messages.push({
                    role: 'assistant',
                    content: [{
                        type: 'tool-call',
                        toolCallId: callId,
                        toolName,
                        input: args
                    } as any]
                });
            } else if (msg.content.type === 'tool_result') {
                const callId = safeString(msg.content.id) || `call-${Date.now()}`;
                const toolName = toolNameById.get(callId) ?? 'unknown';
                messages.push({
                    role: 'tool',
                    content: [{
                        type: 'tool-result',
                        toolCallId: callId,
                        toolName,
                        output: normalizeToolOutput(msg.content.content)
                    } as any]
                });
            } else {
                const fallback = safeString(msg.content);
                const role = msg.role === 'assistant' ? 'assistant' : 'user';
                pushTextMessage(role, fallback);
            }
        }

        const tools: Record<string, any> = {};
        if (prompt.tools && prompt.tools.length > 0) {
            for (const t of prompt.tools) {
                // 对于 @ai-sdk/openai-compatible 等非 OpenAI 原生 provider，
                // jsonSchema() 的包装 { jsonSchema: {...} } 会导致 schema 解析失败（type: null）。
                // 直接传入原始 JSON Schema 对象，让 provider 自行处理。
                const rawSchema = t.inputSchema && typeof t.inputSchema === 'object'
                    ? { ...t.inputSchema }
                    : { type: 'object', properties: {} };
                // 确保顶层有 type: 'object'
                if (!rawSchema.type || rawSchema.type === null) {
                    rawSchema.type = 'object';
                }

                tools[t.name] = tool({
                    description: t.description,
                    parameters: rawSchema as any,
                } as any);
            }
        }

        try {
            console.log('[VercelAIAdapter] streamText start', {
                sdk: this.sdkIdentifier,
                model: this.modelId,
                baseURL: this.baseURL
            });
            const result = streamText({
                model: this.model,
                messages,
                system: prompt.systemPrompt,
                tools: Object.keys(tools).length > 0 ? tools : undefined,
                abortSignal
            } as any);

            let gotAnyChunk = false;
            let activeToolInput: { id: string; name: string; args: string } | null = null;
            for await (const chunk of result.fullStream) {
                gotAnyChunk = true;
                const c = chunk as any;
                if (c?.type) {
                    console.log('[VercelAIAdapter] chunk type:', c.type);
                }
                if (c.type === 'text-delta') {
                    const textDelta = c.textDelta ?? c.text ?? c.delta ?? c.content;
                    if (typeof textDelta === 'string') {
                        onEvent({ type: 'text', data: textDelta });
                    }
                } else if (c.type === 'text-start') {
                    // noop
                } else if (c.type === 'text-end') {
                    // noop
                } else if (c.type === 'tool-call-streaming-start') {
                    if (c.toolCallId && c.toolName) {
                        onEvent({ type: 'tool_call_start', data: { id: c.toolCallId, name: c.toolName } });
                    }
                } else if (c.type === 'tool-call-delta') {
                    if (typeof c.argsTextDelta === 'string') {
                        onEvent({ type: 'tool_call_chunk', data: c.argsTextDelta });
                    }
                } else if (c.type === 'tool-call') {
                    // tool-call-streaming events cover streaming, but if the provider only returns full chunk
                    // ai sdk will fire tool-call directly or at the end. We handle stream-end.
                    if (c.args) {
                        onEvent({ type: 'tool_call_start', data: { id: c.toolCallId, name: c.toolName } });
                        onEvent({ type: 'tool_call_chunk', data: JSON.stringify(c.args) });
                    }
                    onEvent({ type: 'tool_call_end' });
                } else if (c.type === 'tool-input-start') {
                    const id = c.toolCallId ?? c.id ?? c.tool_call_id;
                    const name = c.toolName ?? c.name ?? c.tool_name;
                    if (id && name) {
                        activeToolInput = { id, name, args: '' };
                        onEvent({ type: 'tool_call_start', data: { id, name } });
                    }
                } else if (c.type === 'tool-input-delta') {
                    const delta = c.delta ?? c.textDelta ?? c.argsTextDelta ?? c.inputDelta ?? c.input;
                    if (activeToolInput && typeof delta === 'string') {
                        activeToolInput.args += delta;
                        onEvent({ type: 'tool_call_chunk', data: delta });
                    }
                } else if (c.type === 'tool-input-end') {
                    if (activeToolInput) {
                        onEvent({ type: 'tool_call_end' });
                        activeToolInput = null;
                    }
                } else if (c.type === 'step-finish' || c.type === 'finish') {
                    // Finalization
                } else if (c.type === 'reasoning-delta') {
                    const reasoningDelta = c.reasoningDelta ?? c.reasoning ?? c.delta;
                    if (typeof reasoningDelta === 'string') {
                        onEvent({ type: 'reasoning_chunk', data: reasoningDelta });
                    }
                } else if (c.type === 'error') {
                    // 抛出错误让引擎的 fallback 机制接手，不再发送 done 事件
                    throw new Error(String(c.error));
                }
            }

            if (!gotAnyChunk) {
                console.warn('[VercelAIAdapter] streamText produced no chunks; falling back to generateText');
                const fallback = await generateText({
                    model: this.model,
                    messages,
                    system: prompt.systemPrompt,
                    tools: Object.keys(tools).length > 0 ? tools : undefined,
                    abortSignal
                } as any);

                if (fallback.text) {
                    onEvent({ type: 'text', data: fallback.text });
                }

                if (fallback.toolCalls && fallback.toolCalls.length > 0) {
                    for (const call of fallback.toolCalls as any[]) {
                        const id = call.toolCallId || `tool-${Date.now()}`;
                        const name = call.toolName || 'unknown';
                        onEvent({ type: 'tool_call_start', data: { id, name } });
                        const argsText = JSON.stringify(call.input ?? {});
                        onEvent({ type: 'tool_call_chunk', data: argsText });
                        onEvent({ type: 'tool_call_end' });
                    }
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

export interface StandardTool {
    name: string;
    description: string;
    inputSchema: any; // Using simplified any for JSON Schema initially
}

export interface StandardMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | StandardToolCall | StandardToolResult;
    reasoningContent?: string; // Optional thinking process for models like deepseek-reasoner
}

export interface StandardToolCall {
    type: 'tool_call';
    id: string;
    name: string;
    arguments: any; // Record<string, any> parsed JSON
}

export interface StandardToolResult {
    type: 'tool_result';
    id: string; // Tool call id
    content: string;
}

export interface AgentMessageEvent {
    type: 'text' | 'tool_call_start' | 'tool_call_chunk' | 'tool_call_end' | 'done' | 'error' | 'reasoning_chunk';
    data?: any;
}

export interface StandardPrompt {
    systemPrompt?: string;
    messages: StandardMessage[];
    tools?: StandardTool[];
}

export interface ILLMProvider {
    /**
     * Generates a response stream from the Language Model.
     * Standardizes across all specific SDK implementations.
     */
    generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void,
        abortSignal?: AbortSignal
    ): Promise<void>;

    /**
     * 是否支持向量化生成
     */
    supportsEmbedding(): boolean;

    /**
     * Generates a vector embedding for the given text.
     * 仅当 supportsEmbedding() 为 true 时可调用。
     */
    generateEmbedding?(text: string): Promise<number[]>;
    /**
     * Fetch the list of dynamically available models from the provider's API.
     * Only implemented by providers that support querying /v1/models (like OpenAI).
     */
    listModelsAsync?(): Promise<string[]>;
}

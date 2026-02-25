export interface StandardTool {
    name: string;
    description: string;
    inputSchema: any; // Using simplified any for JSON Schema initially
}

export interface StandardMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | StandardToolCall | StandardToolResult;
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
    type: 'text' | 'tool_call_start' | 'tool_call_chunk' | 'tool_call_end' | 'done' | 'error';
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
        onEvent: (event: AgentMessageEvent) => void
    ): Promise<void>;

    /**
     * Generates a vector embedding for the given text.
     */
    generateEmbedding(text: string): Promise<number[]>;
}

export interface ReplayStep {
    index: number;
    timestamp: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    type: 'text' | 'tool_call' | 'tool_result';
    summary: string;
    projected?: ReplayStepProjection;
    raw: unknown;
}

export interface ReplayStepPolicyDecisionSnapshot {
    decision: 'allow' | 'deny';
    mode: string;
    permissionClass: string;
    reason: string;
    timestamp?: string;
}

export type ReplayStepProjection =
    | {
        kind: 'text';
        content: string;
    }
    | {
        kind: 'tool_call';
        toolCallId: string;
        toolName: string;
        argumentsText: string;
    }
    | {
        kind: 'tool_result';
        toolCallId: string;
        content: string;
        isError: boolean;
        policyDecision?: ReplayStepPolicyDecisionSnapshot;
    };

export type ReplayEvent =
    | {
        type: 'agent:text';
        timestamp: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
    }
    | {
        type: 'agent:tool_call';
        timestamp: string;
        toolCallId: string;
        toolName: string;
        argumentsText: string;
    }
    | {
        type: 'agent:tool_result';
        timestamp: string;
        toolCallId: string;
        toolName: string;
        content: string;
        isError: boolean;
    }
    | {
        type: 'agent:policy_decision';
        timestamp: string;
        toolCallId: string;
        toolName: string;
        decision: 'allow' | 'deny';
        mode: string;
        permissionClass: string;
        reason: string;
    };

export interface ReplayRuntimeDecisionRecord {
    loopIndex: number;
    injectedSkills: string[];
    activeMcpServers: string[];
    reasonSummary?: string;
}

export interface ReplayPolicyDecisionRecord {
    id: string;
    tool: string;
    decision: 'allow' | 'deny';
    mode: string;
    permissionClass: string;
    reason: string;
    timestamp: string;
}

export interface ReplayMetrics {
    messageCountByRole: {
        system: number;
        user: number;
        assistant: number;
        tool: number;
    };
    textMessages: number;
    toolCalls: number;
    toolResults: number;
    totalTextCharacters: number;
    uniqueTools: string[];
}

export interface ReplayBlackboardState {
    currentGoal: string;
    tasks: Array<{ id: string; description: string; status: string }>;
    openFiles: string[];
    lastError: string | null;
}

export interface ReplaySessionSummary {
    title?: string;
    status: string;
    activeAgentId: string;
    messageCount: number;
}

export interface ReplayExport {
    sessionId: string;
    exportedAt: string;
    totalSteps: number;
    steps: ReplayStep[];
    events: ReplayEvent[];
    runtimeDecisions: ReplayRuntimeDecisionRecord[];
    policyDecisions: ReplayPolicyDecisionRecord[];
    metrics: ReplayMetrics;
    blackboard: ReplayBlackboardState;
    session: ReplaySessionSummary;
}

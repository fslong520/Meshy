export const RUNTIME_TASK_STATUSES = [
    'pending',
    'running',
    'in_progress',
    'waiting_approval',
    'blocked',
    'completed',
    'failed',
    'cancelled',
] as const;

export type RuntimeTaskStatus = typeof RUNTIME_TASK_STATUSES[number];

export const RUNTIME_EVENT_TYPES = [
    'tool_call',
    'tool_result',
    'approval_request',
    'background_completion',
    'interrupt',
    'cancel',
] as const;

export type RuntimeEventType = typeof RUNTIME_EVENT_TYPES[number];

interface RuntimeEventBase {
    sessionId: string;
    taskId: string;
    createdAt: string;
}

export interface RuntimeToolCallEvent extends RuntimeEventBase {
    type: 'tool_call';
    toolCallId: string;
    toolName: string;
    argumentsText: string;
}

export interface RuntimeToolResultEvent extends RuntimeEventBase {
    type: 'tool_result';
    toolCallId: string;
    toolName: string;
    content: string;
    isError: boolean;
}

export interface RuntimeApprovalRequestEvent extends RuntimeEventBase {
    type: 'approval_request';
    approvalId: string;
    action: string;
    reason: string;
}

export interface RuntimeBackgroundCompletionEvent extends RuntimeEventBase {
    type: 'background_completion';
    status: Extract<RuntimeTaskStatus, 'completed' | 'failed' | 'cancelled'>;
    summary: string;
}

export interface RuntimeInterruptEvent extends RuntimeEventBase {
    type: 'interrupt';
    reason?: string;
}

export interface RuntimeCancelEvent extends RuntimeEventBase {
    type: 'cancel';
    reason?: string;
}

export type RuntimeEvent =
    | RuntimeToolCallEvent
    | RuntimeToolResultEvent
    | RuntimeApprovalRequestEvent
    | RuntimeBackgroundCompletionEvent
    | RuntimeInterruptEvent
    | RuntimeCancelEvent;

export function createRuntimeTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isTerminalRuntimeTaskStatus(status: RuntimeTaskStatus): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}

import type { AgentMessageEvent } from '../llm/provider.js';

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

export const RUNTIME_STREAM_EVENT_TYPES = [
    'text',
    'reasoning',
    'tool_call_start',
    'tool_call_delta',
    'tool_call_end',
    'done',
    'error',
] as const;

export type RuntimeStreamEventType = typeof RUNTIME_STREAM_EVENT_TYPES[number];

export interface RuntimeStreamEvent {
    type: RuntimeStreamEventType;
    data?: unknown;
    replace?: boolean;
    runtimeEventType?: RuntimeEventType;
}

export function normalizeAgentMessageEvent(event: AgentMessageEvent): RuntimeStreamEvent {
    switch (event.type) {
        case 'text':
            return { type: 'text', data: event.data, replace: event.replace };
        case 'reasoning_chunk':
            return { type: 'reasoning', data: event.data };
        case 'tool_call_start':
            return { type: 'tool_call_start', data: event.data, runtimeEventType: 'tool_call' };
        case 'tool_call_chunk':
            return { type: 'tool_call_delta', data: event.data, runtimeEventType: 'tool_call' };
        case 'tool_call_end':
            return { type: 'tool_call_end', runtimeEventType: 'tool_call' };
        case 'done':
            return { type: 'done', runtimeEventType: 'background_completion' };
        case 'error':
            return { type: 'error', data: event.data, runtimeEventType: 'interrupt' };
        default:
            return { type: 'error', data: `Unknown agent message event: ${(event as AgentMessageEvent).type}` };
    }
}

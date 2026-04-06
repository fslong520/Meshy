import type { ReplayEvent } from './replay-contract.js';

export function normalizeReplayEvents(
    events: ReadonlyArray<unknown> | undefined,
    options: { fallbackTimestamp?: string } = {},
): ReplayEvent[] {
    const fallbackTimestamp = options.fallbackTimestamp ?? new Date().toISOString();
    const normalized: ReplayEvent[] = [];

    for (const rawEvent of events ?? []) {
        if (!rawEvent || typeof rawEvent !== 'object') {
            continue;
        }

        const event = rawEvent as Record<string, unknown>;
        const type = typeof event.type === 'string' ? event.type : '';

        if (type === 'agent:text' || type === 'text') {
            normalized.push({
                type: 'agent:text',
                timestamp: String(event.timestamp ?? fallbackTimestamp),
                role: event.role === 'assistant' || event.role === 'system' ? event.role : 'user',
                content: String(event.content ?? ''),
            });
            continue;
        }

        if (type === 'agent:tool_call' || type === 'tool_call') {
            normalized.push({
                type: 'agent:tool_call',
                timestamp: String(event.timestamp ?? fallbackTimestamp),
                toolCallId: String(event.toolCallId ?? ''),
                toolName: String(event.toolName ?? 'unknown_tool'),
                argumentsText: String(event.argumentsText ?? ''),
            });
            continue;
        }

        if (type === 'agent:tool_result' || type === 'tool_result') {
            normalized.push({
                type: 'agent:tool_result',
                timestamp: String(event.timestamp ?? fallbackTimestamp),
                toolCallId: String(event.toolCallId ?? ''),
                toolName: String(event.toolName ?? 'unknown_tool'),
                content: String(event.content ?? ''),
                isError: Boolean(event.isError),
            });
            continue;
        }

        if (type === 'agent:policy_decision' || type === 'policy_decision') {
            normalized.push({
                type: 'agent:policy_decision',
                timestamp: String(event.timestamp ?? fallbackTimestamp),
                toolCallId: String(event.toolCallId ?? ''),
                toolName: String(event.toolName ?? 'unknown_tool'),
                decision: event.decision === 'deny' ? 'deny' : 'allow',
                mode: String(event.mode ?? 'standard'),
                permissionClass: String(event.permissionClass ?? 'unknown'),
                reason: String(event.reason ?? ''),
            });
        }
    }

    return normalized;
}

import type { ReplayEvent, ReplayPolicyDecisionRecord } from './replay-contract.js';

export type ReplayDerivedStepEvent = Exclude<ReplayEvent, { type: 'agent:policy_decision' }>;

export function deriveReplayEvents(
    stepEvents: ReplayDerivedStepEvent[],
    policyDecisions: ReplayPolicyDecisionRecord[],
): ReplayEvent[] {
    const combined: ReplayEvent[] = [
        ...stepEvents,
        ...policyDecisions.map((decision) => ({
            type: 'agent:policy_decision' as const,
            timestamp: decision.timestamp,
            toolCallId: decision.id,
            toolName: decision.tool,
            decision: decision.decision,
            mode: decision.mode,
            permissionClass: decision.permissionClass,
            reason: decision.reason,
        })),
    ];

    return combined
        .map((event, index) => ({ event, index }))
        .sort((left, right) => {
            const timestampCompare = left.event.timestamp.localeCompare(right.event.timestamp);
            if (timestampCompare !== 0) {
                return timestampCompare;
            }
            return left.index - right.index;
        })
        .map(({ event }) => event);
}

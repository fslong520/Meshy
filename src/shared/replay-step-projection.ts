import type { ReplayStep, ReplayStepPolicyDecisionSnapshot, ReplayStepProjection } from './replay-contract.js';

const isPolicyDecisionSnapshot = (value: unknown): value is ReplayStepPolicyDecisionSnapshot => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (record.decision === 'allow' || record.decision === 'deny')
        && typeof record.mode === 'string'
        && typeof record.permissionClass === 'string'
        && typeof record.reason === 'string';
};

export const getReplayStepProjection = (step: ReplayStep): ReplayStepProjection | null => {
    if (step.projected) {
        return step.projected;
    }

    if (step.type === 'text') {
        return {
            kind: 'text',
            content: typeof step.raw === 'string' ? step.raw : step.summary,
        };
    }

    const raw = step.raw && typeof step.raw === 'object' ? step.raw as Record<string, unknown> : null;

    if (step.type === 'tool_call') {
        return {
            kind: 'tool_call',
            toolCallId: typeof raw?.id === 'string' ? raw.id : `mock-tc-${step.index}`,
            toolName: typeof raw?.name === 'string' ? raw.name : step.summary.replace(/^Tool:\s*/, '').replace(/\(.*$/, ''),
            argumentsText: raw?.arguments !== undefined ? JSON.stringify(raw.arguments) : '',
        };
    }

    if (step.type === 'tool_result') {
        const metadata = raw?.metadata && typeof raw.metadata === 'object' ? raw.metadata as Record<string, unknown> : undefined;
        return {
            kind: 'tool_result',
            toolCallId: typeof raw?.id === 'string' ? raw.id : `tool-call-${step.index}`,
            content: typeof raw?.content === 'string' ? raw.content : step.summary.replace(/^Result:\s*/, ''),
            isError: Boolean(raw?.isError),
            policyDecision: isPolicyDecisionSnapshot(metadata?.policyDecision) ? metadata.policyDecision : undefined,
        };
    }

    return null;
};

import type {
    ReplayBlackboardState,
    ReplayEvent,
    ReplayExport,
    ReplayMetrics,
    ReplayPolicyDecisionRecord,
    ReplaySessionSummary,
    ReplayStep,
} from './replay-contract.js';
import { normalizeReplayEvents } from './replay-normalization.js';

const defaultMetrics = (): ReplayMetrics => ({
    messageCountByRole: { system: 0, user: 0, assistant: 0, tool: 0 },
    textMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalTextCharacters: 0,
    uniqueTools: [],
});

const defaultBlackboard = (value: Record<string, unknown> | undefined): ReplayBlackboardState => ({
    currentGoal: typeof value?.currentGoal === 'string' ? value.currentGoal : '',
    tasks: Array.isArray(value?.tasks) ? value.tasks as ReplayBlackboardState['tasks'] : [],
    openFiles: Array.isArray(value?.openFiles) ? value.openFiles as string[] : [],
    lastError: typeof value?.lastError === 'string' ? value.lastError : null,
});

const defaultSession = (value: Record<string, unknown> | undefined, steps: ReplayStep[]): ReplaySessionSummary => ({
    title: typeof value?.title === 'string' ? value.title : undefined,
    status: typeof value?.status === 'string' ? value.status : 'active',
    activeAgentId: typeof value?.activeAgentId === 'string' ? value.activeAgentId : 'default',
    messageCount: typeof value?.messageCount === 'number' ? value.messageCount : steps.length,
});

export function normalizeReplayExport(
    value: unknown,
    options: {
        deriveEvents?: (steps: ReplayStep[], policyDecisions: ReplayPolicyDecisionRecord[]) => ReplayEvent[];
    } = {},
): ReplayExport {
    const replay = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const steps = Array.isArray(replay.steps) ? replay.steps as ReplayStep[] : [];
    const policyDecisions = Array.isArray(replay.policyDecisions)
        ? replay.policyDecisions as ReplayPolicyDecisionRecord[]
        : [];
    const events = Array.isArray(replay.events)
        ? normalizeReplayEvents(replay.events)
        : options.deriveEvents?.(steps, policyDecisions) ?? [];

    return {
        sessionId: typeof replay.sessionId === 'string' ? replay.sessionId : '',
        exportedAt: typeof replay.exportedAt === 'string' ? replay.exportedAt : '',
        totalSteps: typeof replay.totalSteps === 'number' ? replay.totalSteps : steps.length,
        steps,
        events,
        runtimeDecisions: Array.isArray(replay.runtimeDecisions) ? replay.runtimeDecisions as ReplayExport['runtimeDecisions'] : [],
        policyDecisions,
        metrics: replay.metrics && typeof replay.metrics === 'object' ? replay.metrics as ReplayMetrics : defaultMetrics(),
        blackboard: defaultBlackboard(replay.blackboard as Record<string, unknown> | undefined),
        session: defaultSession(replay.session as Record<string, unknown> | undefined, steps),
    };
}

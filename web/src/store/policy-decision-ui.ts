import type { PolicyDecisionEvent, ToolCallInfo } from './ws'

export type ToolPolicyDecision = NonNullable<ToolCallInfo['policyDecision']>

export function formatPolicyDecisionTimestamp(timestamp: number | undefined): string | null {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().replace('T', ' ')
    : null
}

export function parsePolicyDecisionTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

export function mergePolicyDecision(
  incoming?: {
    decision: 'allow' | 'deny'
    mode: string
    permissionClass: string
    reason: string
    timestamp?: string | number
  },
  existing?: ToolPolicyDecision,
): ToolPolicyDecision | undefined {
  if (!incoming) return existing

  return {
    decision: incoming.decision,
    mode: incoming.mode,
    permissionClass: incoming.permissionClass,
    reason: incoming.reason,
    timestamp: parsePolicyDecisionTimestamp(incoming.timestamp) ?? existing?.timestamp,
  }
}

export function sortPolicyDecisionsNewestFirst<T extends { timestamp: number }>(events: T[]): T[] {
  return [...events].sort((left, right) => right.timestamp - left.timestamp)
}

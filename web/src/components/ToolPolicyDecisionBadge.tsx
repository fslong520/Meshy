import type { ToolCallInfo } from '../store/ws'

interface ToolPolicyDecisionBadgeProps {
  decision?: ToolCallInfo['policyDecision']
}

export function ToolPolicyDecisionBadge({ decision }: ToolPolicyDecisionBadgeProps) {
  if (!decision) return null

  const formattedTimestamp =
    typeof decision.timestamp === 'number' && Number.isFinite(decision.timestamp)
      ? new Date(decision.timestamp).toISOString().replace('T', ' ')
      : null

  return (
    <div className={`tool-policy-badge tool-policy-badge--${decision.decision}`}>
      <span className="tool-policy-badge__title">
        Policy: {decision.decision.toUpperCase()} ({decision.mode}/{decision.permissionClass})
      </span>
      {formattedTimestamp ? <span className="tool-policy-badge__time">{formattedTimestamp}</span> : null}
      <span className="tool-policy-badge__reason">{decision.reason}</span>
    </div>
  )
}

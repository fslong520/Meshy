import type { ToolCallInfo } from '../store/ws'

interface ToolPolicyDecisionBadgeProps {
  decision?: ToolCallInfo['policyDecision']
}

export function ToolPolicyDecisionBadge({ decision }: ToolPolicyDecisionBadgeProps) {
  if (!decision) return null

  return (
    <div className={`tool-policy-badge tool-policy-badge--${decision.decision}`}>
      <span className="tool-policy-badge__title">
        Policy: {decision.decision.toUpperCase()} ({decision.mode}/{decision.permissionClass})
      </span>
      <span className="tool-policy-badge__reason">{decision.reason}</span>
    </div>
  )
}

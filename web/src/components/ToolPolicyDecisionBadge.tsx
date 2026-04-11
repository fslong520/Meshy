import type { ToolCallInfo } from '../store/ws'
import { formatPolicyDecisionTimestamp } from '../store/policy-decision-ui.js'

interface ToolPolicyDecisionBadgeProps {
  decision?: ToolCallInfo['policyDecision']
}

export function ToolPolicyDecisionBadge({ decision }: ToolPolicyDecisionBadgeProps) {
  if (!decision) return null

  const formattedTimestamp = formatPolicyDecisionTimestamp(decision.timestamp)

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

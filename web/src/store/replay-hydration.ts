import type { ChatMessage, PolicyDecisionEvent } from './ws'

interface ReplayStep {
  index: number
  role: 'system' | 'user' | 'assistant'
  type: 'text' | 'tool_call' | 'tool_result'
  summary: string
  raw: unknown
}

interface ReplayExport {
  sessionId: string
  totalSteps: number
  steps: ReplayStep[]
  blackboard: {
    currentGoal: string
    tasks: Array<{ id: string; description: string; status: string }>
  }
  policyDecisions?: Array<{
    id: string
    tool: string
    decision: 'allow' | 'deny'
    mode: string
    permissionClass: string
    reason: string
    timestamp: string
  }>
}

export function replayToMessages(replay: ReplayExport): ChatMessage[] {
  const messages: ChatMessage[] = []

  const ensureAgentContext = (stepIndex: number): ChatMessage => {
    let last = messages[messages.length - 1]
    if (!last || last.role !== 'agent') {
      const agentMsg: ChatMessage = {
        id: `replay-agent-${stepIndex}`,
        role: 'agent',
        content: '',
        timestamp: Date.now(),
        toolCalls: [],
      }
      messages.push(agentMsg)
      last = agentMsg
    }
    if (!last.toolCalls) last.toolCalls = []
    return last
  }

  for (const step of replay.steps) {
    if (step.role === 'system') continue

    if (step.type === 'tool_call') {
      const agent = ensureAgentContext(step.index)
      const raw = step.raw as { id?: string; name?: string; arguments?: unknown } | null
      agent.toolCalls!.push({
        id: raw?.id ?? `mock-tc-${step.index}`,
        name: raw?.name ?? step.summary.replace(/^Tool:\s*/, '').replace(/\(.*$/, ''),
        args: raw?.arguments ? JSON.stringify(raw.arguments) : '',
        status: 'done',
      })
      continue
    }

    if (step.type === 'tool_result') {
      const raw = step.raw as {
        id?: string
        content?: string
        isError?: boolean
        metadata?: {
          policyDecision?: {
            decision: 'allow' | 'deny'
            mode: string
            permissionClass: string
            reason: string
          }
        }
      } | null
      const resultText = raw?.content ?? step.summary.replace(/^Result:\s*/, '')
      const last = messages[messages.length - 1]
      if (last?.role === 'agent' && last.toolCalls) {
        const matchedTc = raw?.id
          ? last.toolCalls.find((tc) => tc.id === raw.id)
          : last.toolCalls[last.toolCalls.length - 1]
        if (matchedTc) {
          matchedTc.result = resultText
          matchedTc.status = raw?.isError ? 'error' : 'done'
          matchedTc.policyDecision = raw?.metadata?.policyDecision
        }
      }
      continue
    }

    const role: 'user' | 'agent' = step.role === 'user' ? 'user' : 'agent'
    messages.push({
      id: `replay-${step.index}`,
      role,
      content: step.type === 'text' ? (step.raw as string) : step.summary,
      timestamp: Date.now(),
    })
  }

  return messages
}

export function hydrateReplayView(replay: ReplayExport): { messages: ChatMessage[]; policyDecisions: PolicyDecisionEvent[] } {
  return {
    messages: replayToMessages(replay),
    policyDecisions: (replay.policyDecisions || []).map((event) => ({
      ...event,
      timestamp: Date.parse(event.timestamp) || Date.now(),
    })),
  }
}

import type { ChatMessage, PolicyDecisionEvent } from './ws'
import type { ReplayEvent, ReplayExport, ReplayStep } from '../../../src/shared/replay-contract.js'

type ReplayInputEvent = ReplayEvent | (ReplayEvent & { type: 'text' | 'tool_call' | 'tool_result' | 'policy_decision' })

type NormalizedReplayEvent = ReplayEvent

function normalizeReplayEvents(events: ReadonlyArray<ReplayInputEvent> | undefined): NormalizedReplayEvent[] {
  const normalized: NormalizedReplayEvent[] = []

  for (const event of events || []) {
    if (event.type === 'agent:text' || event.type === 'text') {
      normalized.push({
        type: 'agent:text',
        timestamp: event.timestamp,
        role: event.role,
        content: event.content,
      })
      continue
    }

    if (event.type === 'agent:tool_call' || event.type === 'tool_call') {
      normalized.push({
        type: 'agent:tool_call',
        timestamp: event.timestamp,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        argumentsText: event.argumentsText,
      })
      continue
    }

    if (event.type === 'agent:tool_result' || event.type === 'tool_result') {
      normalized.push({
        type: 'agent:tool_result',
        timestamp: event.timestamp,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.content,
        isError: event.isError,
      })
      continue
    }

    if (event.type === 'agent:policy_decision' || event.type === 'policy_decision') {
      normalized.push({
        type: 'agent:policy_decision',
        timestamp: event.timestamp,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        decision: event.decision,
        mode: event.mode,
        permissionClass: event.permissionClass,
        reason: event.reason,
      })
    }
  }

  return normalized
}

function eventReplayToMessages(replay: ReplayExport): { messages: ChatMessage[]; policyDecisions: PolicyDecisionEvent[] } {
  const messages: ChatMessage[] = []
  const policyDecisions: PolicyDecisionEvent[] = []

  const ensureAgentContext = (): ChatMessage => {
    let last = messages[messages.length - 1]
    if (!last || last.role !== 'agent') {
      const agentMsg: ChatMessage = {
        id: `replay-agent-${messages.length}`,
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

  for (const event of normalizeReplayEvents(replay.events)) {
    if (event.type === 'agent:text') {
      if (event.role === 'system') continue
      messages.push({
        id: `replay-event-text-${messages.length}`,
        role: event.role === 'user' ? 'user' : 'agent',
        content: event.content,
        timestamp: Date.parse(event.timestamp) || Date.now(),
      })
      continue
    }

    if (event.type === 'agent:tool_call') {
      const agent = ensureAgentContext()
      agent.toolCalls!.push({
        id: event.toolCallId,
        name: event.toolName,
        args: event.argumentsText,
        status: 'done',
      })
      continue
    }

    if (event.type === 'agent:tool_result') {
      const last = messages[messages.length - 1]
      if (last?.role === 'agent' && last.toolCalls) {
        const matched = last.toolCalls.find((toolCall) => toolCall.id === event.toolCallId)
        if (matched) {
          matched.result = event.content
          matched.status = event.isError ? 'error' : 'done'
        }
      }
      continue
    }

    if (event.type === 'agent:policy_decision') {
      policyDecisions.push({
        id: event.toolCallId,
        tool: event.toolName,
        decision: event.decision,
        mode: event.mode,
        permissionClass: event.permissionClass,
        reason: event.reason,
        timestamp: Date.parse(event.timestamp) || Date.now(),
      })

      const last = messages[messages.length - 1]
      if (last?.role === 'agent' && last.toolCalls) {
        const matched = last.toolCalls.find((toolCall) => toolCall.id === event.toolCallId)
        if (matched) {
          matched.policyDecision = {
            decision: event.decision,
            mode: event.mode,
            permissionClass: event.permissionClass,
            reason: event.reason,
          }
        }
      }
    }
  }

  return { messages, policyDecisions }
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
  if (Array.isArray(replay.events) && replay.events.length > 0) {
    return eventReplayToMessages(replay)
  }

  return {
    messages: replayToMessages(replay),
    policyDecisions: (replay.policyDecisions || []).map((event) => ({
      ...event,
      timestamp: Date.parse(event.timestamp) || Date.now(),
    })),
  }
}

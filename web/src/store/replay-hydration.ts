import type { ChatMessage, PolicyDecisionEvent } from './ws'
import type { ReplayEvent, ReplayExport } from '../../../src/shared/replay-contract.js'
import { normalizeReplayEvents } from '../../../src/shared/replay-normalization.js'
import { normalizeReplayExport } from '../../../src/shared/replay-export-normalization.js'
import { getReplayStepProjection } from '../../../src/shared/replay-step-projection.js'
import { parsePolicyDecisionTimestamp } from './policy-decision-ui.js'

type NormalizedReplayEvent = ReplayEvent

function eventReplayToMessages(replay: ReplayExport): { messages: ChatMessage[]; policyDecisions: PolicyDecisionEvent[] } {
  const messages: ChatMessage[] = []
  const policyDecisions: PolicyDecisionEvent[] = []
  const parseReplayTimestamp = (value: string | undefined): number => {
    const parsed = value ? Date.parse(value) : NaN
    return Number.isFinite(parsed) ? parsed : 0
  }

  const ensureAgentContext = (timestamp: number): ChatMessage => {
    let last = messages[messages.length - 1]
    if (!last || last.role !== 'agent') {
      const agentMsg: ChatMessage = {
        id: `replay-agent-${messages.length}`,
        role: 'agent',
        content: '',
        timestamp,
        toolCalls: [],
      }
      messages.push(agentMsg)
      last = agentMsg
    }
    if (!last.toolCalls) last.toolCalls = []
    return last
  }

  for (const event of normalizeReplayEvents(replay.events) as NormalizedReplayEvent[]) {
    if (event.type === 'agent:text') {
      if (event.role === 'system') continue
      messages.push({
        id: `replay-event-text-${messages.length}`,
        role: event.role === 'user' ? 'user' : 'agent',
        content: event.content,
        timestamp: parseReplayTimestamp(event.timestamp),
      })
      continue
    }

    if (event.type === 'agent:tool_call') {
      const agent = ensureAgentContext(parseReplayTimestamp(event.timestamp))
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
        timestamp: parseReplayTimestamp(event.timestamp),
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
            timestamp: parsePolicyDecisionTimestamp(event.timestamp),
          }
        }
      }
    }
  }

  return { messages, policyDecisions }
}

export function replayToMessages(replay: ReplayExport): ChatMessage[] {
  const messages: ChatMessage[] = []
  const parseReplayTimestamp = (value: string | undefined): number => {
    const parsed = value ? Date.parse(value) : NaN
    return Number.isFinite(parsed) ? parsed : 0
  }

  const ensureAgentContext = (stepIndex: number): ChatMessage => {
    let last = messages[messages.length - 1]
    if (!last || last.role !== 'agent') {
      const stepTimestamp = replay.steps.find((step) => step.index === stepIndex)?.timestamp
      const agentMsg: ChatMessage = {
        id: `replay-agent-${stepIndex}`,
        role: 'agent',
        content: '',
        timestamp: parseReplayTimestamp(stepTimestamp),
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
      const projection = getReplayStepProjection(step)
      agent.toolCalls!.push({
        id: projection?.kind === 'tool_call' ? projection.toolCallId : `mock-tc-${step.index}`,
        name: projection?.kind === 'tool_call' ? projection.toolName : step.summary.replace(/^Tool:\s*/, '').replace(/\(.*$/, ''),
        args: projection?.kind === 'tool_call' ? projection.argumentsText : '',
        status: 'done',
      })
      continue
    }

    if (step.type === 'tool_result') {
      const projection = getReplayStepProjection(step)
      const resultText = projection?.kind === 'tool_result' ? projection.content : step.summary.replace(/^Result:\s*/, '')
      const last = messages[messages.length - 1]
      if (last?.role === 'agent' && last.toolCalls) {
        const matchedTc = projection?.kind === 'tool_result'
          ? last.toolCalls.find((tc) => tc.id === projection.toolCallId)
          : last.toolCalls[last.toolCalls.length - 1]
        if (matchedTc) {
          matchedTc.result = resultText
          matchedTc.status = projection?.kind === 'tool_result' && projection.isError ? 'error' : 'done'
          matchedTc.policyDecision = projection?.kind === 'tool_result' && projection.policyDecision
            ? {
              ...projection.policyDecision,
              timestamp: parsePolicyDecisionTimestamp(projection.policyDecision.timestamp),
            }
            : undefined
        }
      }
      continue
    }

    const role: 'user' | 'agent' = step.role === 'user' ? 'user' : 'agent'
    const projection = getReplayStepProjection(step)
    messages.push({
      id: `replay-${step.index}`,
      role,
      content: projection?.kind === 'text' ? projection.content : step.summary,
      timestamp: parseReplayTimestamp(step.timestamp),
    })
  }

  return messages
}

export function hydrateReplayView(replay: ReplayExport): { messages: ChatMessage[]; policyDecisions: PolicyDecisionEvent[] } {
  const normalizedReplay = normalizeReplayExport(replay)

  if (Array.isArray(normalizedReplay.events) && normalizedReplay.events.length > 0) {
    return eventReplayToMessages(normalizedReplay)
  }

  return {
    messages: replayToMessages(normalizedReplay),
    policyDecisions: normalizedReplay.policyDecisions.map((event) => ({
      ...event,
      timestamp: Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : 0,
    })),
  }
}

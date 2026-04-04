import type { ToolCallInfo } from './ws'

export type ToolCallPatch = Partial<Omit<ToolCallInfo, 'id'>> & Pick<ToolCallInfo, 'id'>

export function upsertToolCallById(existing: ToolCallInfo[], patch: ToolCallPatch): ToolCallInfo[] {
  const index = existing.findIndex((tc) => tc.id === patch.id)
  if (index >= 0) {
    const updated = [...existing]
    updated[index] = { ...updated[index], ...patch }
    return updated
  }

  return [
    ...existing,
    {
      id: patch.id,
      name: patch.name || 'UnknownTool',
      args: patch.args || '',
      status: patch.status || 'running',
      result: patch.result,
      approvalReason: patch.approvalReason,
      policyDecision: patch.policyDecision,
    },
  ]
}

export function attachToolError(existing: ToolCallInfo[], input: {
  id?: string
  tool?: string
  errorText: string
  policyDecision?: ToolCallInfo['policyDecision']
}): { list: ToolCallInfo[]; matched: boolean } {
  if (input.id) {
    const hit = existing.find((tc) => tc.id === input.id)
    if (!hit) {
      return {
        list: upsertToolCallById(existing, {
          id: input.id,
          name: input.tool || 'UnknownTool',
          status: 'error',
          result: `⚠️ ${input.errorText}`,
          policyDecision: input.policyDecision,
        }),
        matched: false,
      }
    }
    return {
      list: upsertToolCallById(existing, {
        id: input.id,
        status: 'error',
        result: `⚠️ ${input.errorText}`,
        policyDecision: input.policyDecision ?? hit.policyDecision,
      }),
      matched: true,
    }
  }

  if (input.tool) {
    const runningIndexes = existing
      .map((tc, idx) => ({ tc, idx }))
      .filter(({ tc }) => tc.name === input.tool && tc.status === 'running')
      .map(({ idx }) => idx)

    if (runningIndexes.length > 0) {
      const target = runningIndexes[runningIndexes.length - 1]
      const next = [...existing]
      next[target] = {
        ...next[target],
        status: 'error',
        result: `⚠️ ${input.errorText}`,
        policyDecision: input.policyDecision ?? next[target].policyDecision,
      }
      return { list: next, matched: true }
    }

    return {
      list: [
        ...existing,
        {
          id: `error-${Date.now()}`,
          name: input.tool,
          args: '',
          result: `⚠️ ${input.errorText}`,
          status: 'error',
          policyDecision: input.policyDecision,
        },
      ],
      matched: false,
    }
  }

  return { list: existing, matched: false }
}

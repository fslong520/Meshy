import { describe, expect, it } from 'vitest'
import { attachToolError, upsertToolCallById } from '../../../web/src/store/tool-call-linking.js'
import type { ToolCallInfo } from '../../../web/src/store/ws.js'

describe('tool-call linking helpers', () => {
  it('upserts by id to avoid duplicate cards for out-of-order events', () => {
    let list: ToolCallInfo[] = []

    list = upsertToolCallById(list, {
      id: 'tc-1',
      name: 'write',
      status: 'error',
      result: '⚠️ denied',
    })

    list = upsertToolCallById(list, {
      id: 'tc-1',
      args: '{"filePath":"a.txt"}',
      policyDecision: {
        decision: 'deny',
        mode: 'read_only',
        permissionClass: 'write',
        reason: 'blocked',
      },
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe('tc-1')
    expect(list[0]?.args).toContain('filePath')
    expect(list[0]?.policyDecision?.decision).toBe('deny')
  })

  it('fallback tool-name error matching updates only the most recent running call', () => {
    const initial: ToolCallInfo[] = [
      { id: 'a', name: 'runCommand', args: 'echo a', status: 'running' },
      { id: 'b', name: 'runCommand', args: 'echo b', status: 'running' },
    ]

    const { list } = attachToolError(initial, {
      tool: 'runCommand',
      errorText: 'sandbox denied',
      policyDecision: {
        decision: 'deny',
        mode: 'read_only',
        permissionClass: 'exec',
        reason: 'sandbox denied action',
      },
    })

    expect(list[0]?.status).toBe('running')
    expect(list[1]?.status).toBe('error')
    expect(list[1]?.result).toContain('sandbox denied')
    expect(list[1]?.policyDecision?.permissionClass).toBe('exec')
  })
})

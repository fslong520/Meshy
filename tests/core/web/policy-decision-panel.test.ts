import { describe, expect, it } from 'vitest'
import { PolicyDecisionPanel } from '../../../web/src/components/PolicyDecisionPanel.js'
import type { PolicyDecisionEvent } from '../../../web/src/store/ws.js'

function extractText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join(' ')

  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: unknown } }).props?.children)
  }

  return ''
}

describe('PolicyDecisionPanel', () => {
  it('renders the key policy decision fields', () => {
    const events: PolicyDecisionEvent[] = [
      {
        id: 'policy-1',
        tool: 'write_file',
        decision: 'deny',
        mode: 'safe',
        permissionClass: 'write',
        reason: 'write access requires approval in safe mode',
        timestamp: 1,
      },
    ]

    const rendered = PolicyDecisionPanel({ events })
    const text = extractText(rendered)

    expect(text).toContain('Policy Decisions')
    expect(text).toContain('deny')
    expect(text).toContain('write_file')
    expect(text).toContain('safe')
    expect(text).toContain('write')
    expect(text).toContain('write access requires approval in safe mode')
    expect(text).toContain('1970-01-01 00:00:00.001Z')
  })

  it('orders decisions by timestamp descending instead of input order', () => {
    const events: PolicyDecisionEvent[] = [
      {
        id: 'older',
        tool: 'read_note',
        decision: 'allow',
        mode: 'read_only',
        permissionClass: 'read',
        reason: 'older event',
        timestamp: Date.parse('2026-04-08T00:00:01.000Z'),
      },
      {
        id: 'newer',
        tool: 'write_note',
        decision: 'deny',
        mode: 'read_only',
        permissionClass: 'write',
        reason: 'newer event',
        timestamp: Date.parse('2026-04-08T00:00:03.000Z'),
      },
    ]

    const rendered = PolicyDecisionPanel({ events })
    const text = extractText(rendered)

    expect(text.indexOf('newer event')).toBeLessThan(text.indexOf('older event'))
  })
})

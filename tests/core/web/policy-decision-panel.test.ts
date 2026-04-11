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

  it('shows only the newest six entries in current mode', () => {
    const events: PolicyDecisionEvent[] = Array.from({ length: 8 }, (_, index) => ({
      id: `event-${index}`,
      tool: `tool-${index}`,
      decision: index % 2 === 0 ? 'allow' : 'deny',
      mode: 'read_only',
      permissionClass: index % 2 === 0 ? 'read' : 'write',
      reason: `event-${index}`,
      timestamp: index,
    }))

    const rendered = PolicyDecisionPanel({ events, mode: 'current' })
    const text = extractText(rendered)

    expect(text).toContain('8')
    expect(text).toContain('event-7')
    expect(text).toContain('event-2')
    expect(text).not.toContain('event-1')
    expect(text).not.toContain('event-0')
  })

  it('shows full history in audit mode and allows duplicate ids', () => {
    const events: PolicyDecisionEvent[] = [
      {
        id: 'tool-call-1',
        tool: 'write_note',
        decision: 'allow',
        mode: 'read_only',
        permissionClass: 'read',
        reason: 'older version',
        timestamp: 1,
      },
      {
        id: 'tool-call-1',
        tool: 'write_note',
        decision: 'deny',
        mode: 'read_only',
        permissionClass: 'write',
        reason: 'newer version',
        timestamp: 3,
      },
      {
        id: 'tool-call-2',
        tool: 'read_note',
        decision: 'allow',
        mode: 'read_only',
        permissionClass: 'read',
        reason: 'another event',
        timestamp: 2,
      },
    ]

    const rendered = PolicyDecisionPanel({ events, mode: 'audit' })
    const text = extractText(rendered)

    expect(text).toContain('3')
    expect(text.indexOf('newer version')).toBeLessThan(text.indexOf('another event'))
    expect(text.indexOf('another event')).toBeLessThan(text.indexOf('older version'))
  })

  it('does not truncate audit mode to the newest six entries', () => {
    const events: PolicyDecisionEvent[] = Array.from({ length: 8 }, (_, index) => ({
      id: `tool-call-${index}`,
      tool: `tool-${index}`,
      decision: index % 2 === 0 ? 'allow' : 'deny',
      mode: 'read_only',
      permissionClass: index % 2 === 0 ? 'read' : 'write',
      reason: `history-${index}`,
      timestamp: index,
    }))

    const rendered = PolicyDecisionPanel({ events, mode: 'audit' })
    const text = extractText(rendered)

    expect(text).toContain('8')
    expect(text).toContain('history-7')
    expect(text).toContain('history-0')
  })
})

import { describe, expect, it } from 'vitest'
import { ToolPolicyDecisionBadge } from '../../../web/src/components/ToolPolicyDecisionBadge.js'

function extractText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join(' ')
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

describe('ToolPolicyDecisionBadge', () => {
  it('renders structured policy decision details', () => {
    const rendered = ToolPolicyDecisionBadge({
      decision: {
        decision: 'deny',
        mode: 'read_only',
        permissionClass: 'write',
        reason: 'permissionClass write is blocked in read-only mode',
      },
    })

    const text = extractText(rendered)
    expect(text).toContain('Policy:')
    expect(text).toContain('DENY')
    expect(text).toContain('read_only')
    expect(text).toContain('write')
    expect(text).toContain('permissionClass write is blocked in read-only mode')
  })

  it('returns null for missing policy decisions', () => {
    expect(ToolPolicyDecisionBadge({ decision: undefined })).toBeNull()
  })
})

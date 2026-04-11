import { describe, expect, it } from 'vitest'
import {
  formatPolicyDecisionTimestamp,
  mergePolicyDecision,
  sortPolicyDecisionsNewestFirst,
} from '../../../web/src/store/policy-decision-ui.js'

describe('policy decision UI helpers', () => {
  it('formats persisted timestamps consistently for UI surfaces', () => {
    expect(formatPolicyDecisionTimestamp(Date.parse('2026-04-08T00:00:07.000Z'))).toBe('2026-04-08 00:00:07.000Z')
    expect(formatPolicyDecisionTimestamp(undefined)).toBeNull()
  })

  it('merges incoming policy decisions while preserving existing parsed timestamp', () => {
    expect(
      mergePolicyDecision(
        {
          decision: 'deny',
          mode: 'read_only',
          permissionClass: 'write',
          reason: 'blocked',
        },
        {
          decision: 'deny',
          mode: 'read_only',
          permissionClass: 'write',
          reason: 'blocked',
          timestamp: 123,
        },
      ),
    ).toEqual({
      decision: 'deny',
      mode: 'read_only',
      permissionClass: 'write',
      reason: 'blocked',
      timestamp: 123,
    })
  })

  it('sorts policy decisions newest first by timestamp', () => {
    const sorted = sortPolicyDecisionsNewestFirst([
      {
        id: 'older',
        tool: 'read_note',
        decision: 'allow',
        mode: 'read_only',
        permissionClass: 'read',
        reason: 'older',
        timestamp: 1,
      },
      {
        id: 'newer',
        tool: 'write_note',
        decision: 'deny',
        mode: 'read_only',
        permissionClass: 'write',
        reason: 'newer',
        timestamp: 3,
      },
    ])

    expect(sorted.map((event) => event.id)).toEqual(['newer', 'older'])
  })
})

import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

describe('policy decision UI helper adoption', () => {
  it('uses the shared frontend helper from badge, panel, and app', () => {
    const badgeSource = read('web/src/components/ToolPolicyDecisionBadge.tsx')
    const panelSource = read('web/src/components/PolicyDecisionPanel.tsx')
    const appSource = read('web/src/App.tsx')

    expect(badgeSource).toContain("from '../store/policy-decision-ui.js'")
    expect(panelSource).toContain("from '../store/policy-decision-ui.js'")
    expect(appSource).toContain("from './store/policy-decision-ui.js'")

    expect(appSource).not.toContain('function parsePolicyDecisionTimestamp(')
    expect(appSource).not.toContain('function mergePolicyDecision(')
    expect(panelSource).not.toContain('function formatPersistedTimestamp(')
  })
})

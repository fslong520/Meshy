# Server, Harness, and Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the user-facing webserver startup command from `daemon` to `server`, extract a dedicated `src/core/harness/` domain for replay-driven fixtures and deterministic evaluation, add a server-facing harness adapter, and ship a v1 declarative plugin/preset foundation.

**Architecture:** Keep the current runtime/session stack intact and add focused harness modules under `src/core/harness/` that consume `ReplayExport` instead of inventing a second execution engine. Keep plugin v1 strictly declarative and local-only: manifests, loader, registry, preset resolver, and a thin server adapter, without wiring plugin activation into every existing subsystem yet.

**Tech Stack:** TypeScript, Node.js, ws/http server, existing Meshy session/replay/workspace runtime, Vitest via `npx vitest run`, tsup build.

---

## File structure map

### Existing files to modify
- `src/index.ts`
  - Owns CLI argument parsing and top-level `runServer()` startup flow.
  - Will expose testable command parsing and rename the user-facing webserver startup command from `daemon` to `server` while preserving a compatibility path.
- `src/core/session/replay.ts`
  - Owns `ReplayExport`, replay persistence, and replay compatibility normalization.
  - Harness must consume this module directly.
- `src/core/engine/index.ts`
  - Existing integration point for runtime/server-facing services.
  - Only touch if the harness adapter needs a minimal integration seam.
- `src/core/workspace/workspace.ts`
  - Only touch if a harness store/service instance truly belongs on the workspace object after tests prove that wiring is necessary.

### New harness files to create
- `src/core/harness/artifacts/types.ts`
  - Harness-owned contracts from the spec.
- `src/core/harness/artifacts/artifact-store.ts`
  - JSON persistence under `.meshy/harness/{fixtures,runs,reports}`.
- `src/core/harness/fixtures/fixture-recorder.ts`
  - Replay → fixture conversion.
- `src/core/harness/attribution/failure-attributor.ts`
  - Deterministic v1 failure classification and summary generation.
- `src/core/harness/evaluation/scoring.ts`
  - Deterministic `0..1` score calculation.
- `src/core/harness/evaluation/evaluation-service.ts`
  - Fixture evaluation orchestration plus run/report persistence.
- `src/core/server/harness/adapter.ts`
  - Thin server-facing harness wrapper.

### New plugin files to create
- `src/core/plugins/manifest.ts`
  - Declarative plugin + preset schema and manifest validation.
- `src/core/plugins/loader.ts`
  - Local plugin discovery and manifest loading.
- `src/core/plugins/registry.ts`
  - Loaded plugin registry plus ephemeral in-memory active preset state.
- `src/core/plugins/presets/tool-preset.ts`
  - Preset expansion and deduplicated active capability set generation.
- `src/core/server/plugins/adapter.ts`
  - Thin server-facing plugin wrapper over loader + registry.

### Tests to create
- `tests/cli/server-command.test.ts`
  - Verifies `server` startup parsing and `daemon` compatibility alias behavior.
- `tests/core/harness/artifact-store.test.ts`
  - Verifies fixture/run/report persistence.
- `tests/core/harness/fixture-recorder.test.ts`
  - Verifies replay → fixture recording from real `ReplayExport` input.
- `tests/core/harness/failure-attributor.test.ts`
  - Verifies failure classification and summary generation.
- `tests/core/harness/scoring.test.ts`
  - Verifies deterministic score calculation.
- `tests/core/harness/evaluation-service.test.ts`
  - Verifies pass/fail, scores, attribution, and persisted run/report ids using real replay-backed fixture data.
- `tests/core/harness/harness-e2e.test.ts`
  - Verifies the spec-required replay → fixture → evaluation → attribution end-to-end chain.
- `tests/core/harness/server-adapter.test.ts`
  - Verifies the harness server adapter delegates through real harness services.
- `tests/core/plugins/loader.test.ts`
  - Verifies manifest loading/validation for local declarative plugins.
- `tests/core/plugins/registry.test.ts`
  - Verifies preset activation, deduplication, and disable recomputation.
- `tests/core/server/plugins-adapter.test.ts`
  - Verifies the server plugin adapter lists plugins/presets and toggles active preset state.

---

### Task 1: Rename the user-facing webserver startup command to `server`

**Files:**
- Modify: `src/index.ts`
- Test: `tests/cli/server-command.test.ts`

- [ ] **Step 1: Write the failing CLI parsing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/index.js';

describe('parseArgs', () => {
  it('treats server as the webserver startup subcommand', () => {
    expect(parseArgs(['node', 'meshy', 'server', '--port', '9999'])).toMatchObject({
      subcommand: 'server',
      port: 9999,
    });
  });

  it('treats daemon as a compatibility alias for the server startup command', () => {
    expect(parseArgs(['node', 'meshy', 'daemon', '--port', '9999'])).toMatchObject({
      subcommand: 'server',
      port: 9999,
    });
  });
});
```

- [ ] **Step 2: Run the CLI parsing test to verify it fails for the expected reason**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/cli/server-command.test.ts`
Expected: FAIL because `parseArgs` is not exported yet or because `daemon` is not yet treated as a compatibility alias subcommand.

- [ ] **Step 3: Export the smallest testable CLI parsing surface**

In `src/index.ts`, export `parseArgs` without changing unrelated startup behavior.

- [ ] **Step 4: Implement the minimal command rename behavior**

In `src/index.ts`, ensure:
- `server` is the primary user-facing startup subcommand
- `daemon` is accepted as a compatibility alias subcommand
- help comments and startup text refer to `server`
- existing `--daemon` flag compatibility can remain only if it is already present and low-cost to keep

- [ ] **Step 5: Run the CLI parsing test to verify it passes**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/cli/server-command.test.ts`
Expected: PASS

- [ ] **Step 6: Run a build smoke check**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npm run build`
Expected: build succeeds

- [ ] **Step 7: Commit the command rename slice**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/index.ts tests/cli/server-command.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(cli): rename daemon startup command to server"
```

---

### Task 2: Add harness artifact contracts and persistence

**Files:**
- Create: `src/core/harness/artifacts/types.ts`
- Create: `src/core/harness/artifacts/artifact-store.ts`
- Modify only if tests require: `src/core/workspace/workspace.ts`
- Test: `tests/core/harness/artifact-store.test.ts`

- [ ] **Step 1: Write the failing artifact store test**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessArtifactStore } from '../../../src/core/harness/artifacts/artifact-store.js';

describe('HarnessArtifactStore', () => {
  it('persists fixtures, runs, and reports under .meshy/harness', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-harness-store-'));
    const store = new HarnessArtifactStore(root);

    await store.saveFixture({ schemaVersion: 1, id: 'fx-1', title: 'fixture', sourceReplayId: 'r-1', createdAt: '2026-03-18T00:00:00.000Z', expected: {}, replay: { sessionId: 'r-1', exportedAt: '2026-03-18T00:00:00.000Z', totalSteps: 0, steps: [], metrics: { messageCountByRole: { system: 0, user: 0, assistant: 0, tool: 0 }, textMessages: 0, toolCalls: 0, toolResults: 0, totalTextCharacters: 0, uniqueTools: [] }, blackboard: { currentGoal: '', tasks: [], openFiles: [], lastError: null }, session: { status: 'active', activeAgentId: 'default', messageCount: 0 } } });
    await store.saveRun({ schemaVersion: 1, id: 'run-1', fixtureId: 'fx-1', startedAt: '2026-03-18T00:00:00.000Z', status: 'passed', scores: { goalCompletion: 1, outputMatch: 1, toolUsageMatch: 1 } });
    await store.saveReport({ schemaVersion: 1, id: 'rep-1', fixtureId: 'fx-1', runId: 'run-1', createdAt: '2026-03-18T00:00:01.000Z', status: 'passed', scores: { goalCompletion: 1, outputMatch: 1, toolUsageMatch: 1 }, summary: 'ok' });

    expect(await store.loadFixture('fx-1')).not.toBeNull();
    expect(await store.loadRun('run-1')).not.toBeNull();
    expect(await store.loadReport('rep-1')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the artifact store test to verify it fails**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/artifact-store.test.ts`
Expected: FAIL because harness artifact modules do not exist yet.

- [ ] **Step 3: Create the harness type contracts**

In `src/core/harness/artifacts/types.ts`, define the exact v1 contracts from the spec.

- [ ] **Step 4: Implement the minimal artifact store**

In `src/core/harness/artifacts/artifact-store.ts`, implement JSON persistence under `.meshy/harness/{fixtures,runs,reports}` with the exact save/load methods from the spec.

- [ ] **Step 5: Only touch workspace wiring if a failing test proves it is needed**

Do not modify `src/core/workspace/workspace.ts` unless later adapter tests prove the store should live there.

- [ ] **Step 6: Run the artifact store test to verify it passes**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/artifact-store.test.ts`
Expected: PASS

- [ ] **Step 7: Run a build smoke check**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npm run build`
Expected: build succeeds

- [ ] **Step 8: Commit the artifact layer**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/core/harness/artifacts/types.ts src/core/harness/artifacts/artifact-store.ts tests/core/harness/artifact-store.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(harness): add artifact persistence layer"
```

---

### Task 3: Record fixtures from replay exports

**Files:**
- Create: `src/core/harness/fixtures/fixture-recorder.ts`
- Modify only if tests require: `src/core/session/replay.ts`
- Test: `tests/core/harness/fixture-recorder.test.ts`

- [ ] **Step 1: Write the failing fixture recorder test**

```ts
import { describe, expect, it } from 'vitest';
import { FixtureRecorder } from '../../../src/core/harness/fixtures/fixture-recorder.js';

describe('FixtureRecorder', () => {
  it('creates a replay-backed fixture from ReplayExport', async () => {
    const recorder = new FixtureRecorder();
    const fixture = await recorder.recordFromReplay({
      sessionId: 's-1',
      exportedAt: '2026-03-18T00:00:00.000Z',
      totalSteps: 1,
      steps: [],
      metrics: { messageCountByRole: { system: 0, user: 1, assistant: 0, tool: 0 }, textMessages: 1, toolCalls: 0, toolResults: 0, totalTextCharacters: 5, uniqueTools: [] },
      blackboard: { currentGoal: 'ship harness', tasks: [], openFiles: [], lastError: null },
      session: { status: 'active', activeAgentId: 'default', messageCount: 1 },
    }, { title: 'Harness regression' });

    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.sourceReplayId).toBe('s-1');
    expect(fixture.title).toBe('Harness regression');
    expect(fixture.goal).toBe('ship harness');
    expect(fixture.replay.sessionId).toBe('s-1');
  });
});
```

- [ ] **Step 2: Run the fixture recorder test to verify it fails**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/fixture-recorder.test.ts`
Expected: FAIL because recorder module does not exist.

- [ ] **Step 3: Implement the smallest replay-backed fixture recorder**

In `src/core/harness/fixtures/fixture-recorder.ts`, convert `ReplayExport` into `ScenarioFixture` using only the spec fields.

- [ ] **Step 4: Only normalize replay if the test proves it is necessary**

Do not broaden `src/core/session/replay.ts` unless the recorder test reveals a compatibility gap that must be fixed there.

- [ ] **Step 5: Run the fixture recorder test to verify it passes**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/fixture-recorder.test.ts`
Expected: PASS

- [ ] **Step 6: Run focused replay regression tests**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/session/replay.test.ts tests/core/session/replay-compat.test.ts`
Expected: PASS

- [ ] **Step 7: Commit the fixture recording slice**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/core/harness/fixtures/fixture-recorder.ts tests/core/harness/fixture-recorder.test.ts tests/core/session/replay.test.ts tests/core/session/replay-compat.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(harness): record fixtures from replay exports"
```

---

### Task 4: Add failure attribution and deterministic scoring

**Files:**
- Create: `src/core/harness/attribution/failure-attributor.ts`
- Create: `src/core/harness/evaluation/scoring.ts`
- Test: `tests/core/harness/failure-attributor.test.ts`
- Test: `tests/core/harness/scoring.test.ts`

- [ ] **Step 1: Write the failing attribution test**

```ts
import { describe, expect, it } from 'vitest';
import { FailureAttributor } from '../../../src/core/harness/attribution/failure-attributor.js';

describe('FailureAttributor', () => {
  it('classifies tool failures as tool_error with a summary', () => {
    const attributor = new FailureAttributor();
    const result = attributor.attribute({
      run: { schemaVersion: 1, id: 'run-1', fixtureId: 'fx-1', startedAt: '2026-03-18T00:00:00.000Z', status: 'failed', scores: { goalCompletion: 0, outputMatch: 0, toolUsageMatch: 0 } },
      error: new Error('Tool bash failed with exit code 1'),
    });

    expect(result.type).toBe('tool_error');
    expect(result.summary).toContain('Tool');
  });
});
```

- [ ] **Step 2: Write the failing scoring test**

```ts
import { describe, expect, it } from 'vitest';
import { scoreFixtureRun } from '../../../src/core/harness/evaluation/scoring.js';

describe('scoreFixtureRun', () => {
  it('returns full scores when all configured expectations are satisfied', () => {
    const scores = scoreFixtureRun(
      { expected: { outputMarkers: ['done'], requiredTools: ['readFile'] } } as any,
      { outputText: 'done', toolNames: ['readFile'], finalStatus: 'passed' },
    );

    expect(scores).toEqual({ goalCompletion: 1, outputMatch: 1, toolUsageMatch: 1 });
  });
});
```

- [ ] **Step 3: Run the attribution and scoring tests to verify they fail**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/failure-attributor.test.ts tests/core/harness/scoring.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the smallest deterministic failure attribution**

In `src/core/harness/attribution/failure-attributor.ts`, classify by simple string/shape heuristics only.

- [ ] **Step 5: Implement the v1 scoring contract**

In `src/core/harness/evaluation/scoring.ts`, implement deterministic `0..1` scores from the spec and no weighting system.

- [ ] **Step 6: Run the attribution and scoring tests to verify they pass**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/failure-attributor.test.ts tests/core/harness/scoring.test.ts`
Expected: PASS

- [ ] **Step 7: Run a build smoke check**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npm run build`
Expected: build succeeds

- [ ] **Step 8: Commit the scoring and attribution slice**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/core/harness/attribution/failure-attributor.ts src/core/harness/evaluation/scoring.ts tests/core/harness/failure-attributor.test.ts tests/core/harness/scoring.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(harness): add scoring and failure attribution"
```

---

### Task 5: Build the evaluation service and the required end-to-end harness chain

**Files:**
- Create: `src/core/harness/evaluation/evaluation-service.ts`
- Modify: `src/core/harness/artifacts/artifact-store.ts`
- Test: `tests/core/harness/evaluation-service.test.ts`
- Test: `tests/core/harness/harness-e2e.test.ts`

- [ ] **Step 1: Write the failing evaluation service test**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessArtifactStore } from '../../../src/core/harness/artifacts/artifact-store.js';
import { FixtureRecorder } from '../../../src/core/harness/fixtures/fixture-recorder.js';
import { EvaluationService } from '../../../src/core/harness/evaluation/evaluation-service.js';

describe('EvaluationService', () => {
  it('returns pass/fail, scores, attribution, and persisted report ids from a replay-backed fixture', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-eval-'));
    const store = new HarnessArtifactStore(root);
    const recorder = new FixtureRecorder();
    const service = new EvaluationService(store);
    const fixture = await recorder.recordFromReplay({
      sessionId: 's-1',
      exportedAt: '2026-03-18T00:00:00.000Z',
      totalSteps: 2,
      steps: [
        { index: 0, timestamp: '2026-03-18T00:00:00.000Z', role: 'assistant', type: 'tool_call', summary: 'Tool: readFile({})', raw: { type: 'tool_call', id: '1', name: 'readFile', arguments: {} } },
        { index: 1, timestamp: '2026-03-18T00:00:01.000Z', role: 'assistant', type: 'text', summary: 'done', raw: 'done' },
      ],
      metrics: { messageCountByRole: { system: 0, user: 0, assistant: 2, tool: 0 }, textMessages: 1, toolCalls: 1, toolResults: 0, totalTextCharacters: 4, uniqueTools: ['readFile'] },
      blackboard: { currentGoal: 'ship harness', tasks: [], openFiles: [], lastError: null },
      session: { status: 'active', activeAgentId: 'default', messageCount: 2 },
    }, { expected: { outputMarkers: ['done'], requiredTools: ['readFile'] } });

    const result = await service.runFixture(fixture);

    expect(result.status).toBe('passed');
    expect(result.reportId).toBeTruthy();
    expect(result.scores.outputMatch).toBe(1);
    expect(await store.loadRun(result.runId)).not.toBeNull();
    expect(await store.loadReport(result.reportId!)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing end-to-end harness test**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessArtifactStore } from '../../../src/core/harness/artifacts/artifact-store.js';
import { FixtureRecorder } from '../../../src/core/harness/fixtures/fixture-recorder.js';
import { EvaluationService } from '../../../src/core/harness/evaluation/evaluation-service.js';
import { FailureAttributor } from '../../../src/core/harness/attribution/failure-attributor.js';

describe('harness e2e', () => {
  it('covers replay to fixture to evaluation to attribution', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-harness-e2e-'));
    const store = new HarnessArtifactStore(root);
    const recorder = new FixtureRecorder();
    const attributor = new FailureAttributor();
    const service = new EvaluationService(store, attributor);

    const fixture = await recorder.recordFromReplay({
      sessionId: 's-fail',
      exportedAt: '2026-03-18T00:00:00.000Z',
      totalSteps: 1,
      steps: [{ index: 0, timestamp: '2026-03-18T00:00:00.000Z', role: 'assistant', type: 'text', summary: 'not-done', raw: 'not-done' }],
      metrics: { messageCountByRole: { system: 0, user: 0, assistant: 1, tool: 0 }, textMessages: 1, toolCalls: 0, toolResults: 0, totalTextCharacters: 8, uniqueTools: [] },
      blackboard: { currentGoal: 'ship harness', tasks: [], openFiles: [], lastError: null },
      session: { status: 'active', activeAgentId: 'default', messageCount: 1 },
    }, { expected: { outputMarkers: ['done'], requiredTools: ['readFile'] } });

    const result = await service.runFixture(fixture);

    expect(result.status).toBe('failed');
    expect(result.attribution).toBeTruthy();
    expect(result.attribution?.summary.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the evaluation and end-to-end tests to verify they fail**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/evaluation-service.test.ts tests/core/harness/harness-e2e.test.ts`
Expected: FAIL because the evaluation service does not exist yet.

- [ ] **Step 4: Implement the smallest deterministic evaluation service**

In `src/core/harness/evaluation/evaluation-service.ts`:
- derive output text and tool names from replay-backed fixture data
- compute scores via `scoreFixtureRun`
- decide `passed/failed`
- attach attribution for failed runs
- persist both `HarnessRunRecord` and `HarnessReport`
- return `HarnessRunResult`

- [ ] **Step 5: Run the evaluation and end-to-end tests to verify they pass**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/evaluation-service.test.ts tests/core/harness/harness-e2e.test.ts`
Expected: PASS

- [ ] **Step 6: Run the harness suite together**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/artifact-store.test.ts tests/core/harness/fixture-recorder.test.ts tests/core/harness/failure-attributor.test.ts tests/core/harness/scoring.test.ts tests/core/harness/evaluation-service.test.ts tests/core/harness/harness-e2e.test.ts`
Expected: PASS

- [ ] **Step 7: Commit the evaluation slice**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/core/harness/evaluation/evaluation-service.ts src/core/harness/artifacts/artifact-store.ts tests/core/harness/evaluation-service.test.ts tests/core/harness/harness-e2e.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(harness): evaluate fixtures end to end"
```

---

### Task 6: Add the server-facing harness adapter

**Files:**
- Create: `src/core/server/harness/adapter.ts`
- Modify only if tests require: `src/index.ts`
- Modify only if tests require: `src/core/engine/index.ts`
- Test: `tests/core/harness/server-adapter.test.ts`

- [ ] **Step 1: Write the failing harness adapter test**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessServerAdapter } from '../../../src/core/server/harness/adapter.js';

describe('HarnessServerAdapter', () => {
  it('creates fixtures from replay paths and returns persisted ids from real harness services', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-harness-adapter-'));
    const adapter = new HarnessServerAdapter(root);

    const replayPath = path.join(root, 'sample.replay.json');
    fs.writeFileSync(replayPath, JSON.stringify({
      sessionId: 's-1',
      exportedAt: '2026-03-18T00:00:00.000Z',
      totalSteps: 1,
      steps: [{ index: 0, timestamp: '2026-03-18T00:00:00.000Z', role: 'assistant', type: 'text', summary: 'done', raw: 'done' }],
      metrics: { messageCountByRole: { system: 0, user: 0, assistant: 1, tool: 0 }, textMessages: 1, toolCalls: 0, toolResults: 0, totalTextCharacters: 4, uniqueTools: [] },
      blackboard: { currentGoal: 'ship harness', tasks: [], openFiles: [], lastError: null },
      session: { status: 'active', activeAgentId: 'default', messageCount: 1 },
    }), 'utf8');

    const fixture = await adapter.createFixtureFromReplay(replayPath, { expected: { outputMarkers: ['done'] } });
    const result = await adapter.runFixture(fixture.fixtureId);

    expect(fixture.fixtureId).toBeTruthy();
    expect(result.runId).toBeTruthy();
    expect(result.reportId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the harness adapter test to verify it fails**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/server-adapter.test.ts`
Expected: FAIL because adapter module does not exist.

- [ ] **Step 3: Implement the thin harness adapter**

In `src/core/server/harness/adapter.ts`, add methods:
- `createFixtureFromReplay(replayPath, options?)`
- `runFixture(fixtureId)`
- `getRun(runId)`
- `getReport(reportId)`

Use real harness services directly.

- [ ] **Step 4: Only add runtime integration if a failing test proves it is needed**

Do not touch `src/index.ts` or `src/core/engine/index.ts` unless there is a concrete server surface that must expose this adapter now.

- [ ] **Step 5: Run the harness adapter test to verify it passes**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/harness/server-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Run a build smoke check**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npm run build`
Expected: build succeeds

- [ ] **Step 7: Commit the harness adapter slice**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/core/server/harness/adapter.ts tests/core/harness/server-adapter.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(server): add harness adapter"
```

---

### Task 7: Add declarative plugin manifest loading

**Files:**
- Create: `src/core/plugins/manifest.ts`
- Create: `src/core/plugins/loader.ts`
- Test: `tests/core/plugins/loader.test.ts`

- [ ] **Step 1: Write the failing plugin loader test**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginLoader } from '../../../src/core/plugins/loader.js';

describe('PluginLoader', () => {
  it('loads a local declarative plugin manifest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-plugin-'));
    const pluginDir = path.join(root, 'demo');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'demo',
      name: 'Demo Plugin',
      version: '1.0.0',
      presets: [{ id: 'default', name: 'Default', tools: ['readFile'] }],
    }), 'utf8');

    const loader = new PluginLoader([root]);
    const plugins = loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.id).toBe('demo');
  });
});
```

- [ ] **Step 2: Run the plugin loader test to verify it fails**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/plugins/loader.test.ts`
Expected: FAIL because plugin modules do not exist.

- [ ] **Step 3: Implement declarative manifest contracts**

In `src/core/plugins/manifest.ts`, define the manifest/preset contracts and validation helpers.

- [ ] **Step 4: Implement the smallest local plugin loader**

In `src/core/plugins/loader.ts`, scan configured directories, read `plugin.json`, validate it, and return descriptors. No executable plugin code.

- [ ] **Step 5: Run the plugin loader test to verify it passes**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/plugins/loader.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the plugin loader slice**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/core/plugins/manifest.ts src/core/plugins/loader.ts tests/core/plugins/loader.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(plugins): load declarative local manifests"
```

---

### Task 8: Add preset resolution and in-memory plugin registry state

**Files:**
- Create: `src/core/plugins/registry.ts`
- Create: `src/core/plugins/presets/tool-preset.ts`
- Test: `tests/core/plugins/registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

```ts
import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../../src/core/plugins/registry.js';

describe('PluginRegistry', () => {
  it('enables and disables plugin-local presets using composite ids', () => {
    const registry = new PluginRegistry([
      {
        manifest: {
          id: 'demo',
          name: 'Demo',
          version: '1.0.0',
          presets: [
            { id: 'default', name: 'Default', tools: ['readFile'], skills: ['code-review'] },
            { id: 'mcp', name: 'MCP', mcpServers: ['filesystem'] },
          ],
        },
      } as any,
    ]);

    registry.enablePreset('demo/default');
    expect(registry.getActiveCapabilities().tools).toContain('readFile');
    registry.enablePreset('demo/mcp');
    registry.disablePreset('demo/default');
    expect(registry.getActiveCapabilities().tools).not.toContain('readFile');
    expect(registry.getActiveCapabilities().mcpServers).toContain('filesystem');
  });
});
```

- [ ] **Step 2: Run the registry test to verify it fails**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/plugins/registry.test.ts`
Expected: FAIL because registry modules do not exist.

- [ ] **Step 3: Implement the tool preset resolver**

In `src/core/plugins/presets/tool-preset.ts`, flatten and deduplicate tools, skills, agents, and MCP servers from enabled presets.

- [ ] **Step 4: Implement the in-memory plugin registry**

In `src/core/plugins/registry.ts`, support:
- list plugins
- list presets
- enable preset by `<plugin-id>/<preset-id>`
- disable preset by composite id
- recompute merged active capability set after every state change

Keep state ephemeral and process-local.

- [ ] **Step 5: Run the registry test to verify it passes**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/plugins/registry.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the registry slice**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/core/plugins/registry.ts src/core/plugins/presets/tool-preset.ts tests/core/plugins/registry.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(plugins): add preset registry and resolver"
```

---

### Task 9: Add the server-facing plugin adapter

**Files:**
- Create: `src/core/server/plugins/adapter.ts`
- Test: `tests/core/server/plugins-adapter.test.ts`

- [ ] **Step 1: Write the failing server plugin adapter test**

```ts
import { describe, expect, it } from 'vitest';
import { ServerPluginAdapter } from '../../../src/core/server/plugins/adapter.js';
import { PluginRegistry } from '../../../src/core/plugins/registry.js';

describe('ServerPluginAdapter', () => {
  it('lists plugins and toggles presets through the registry', () => {
    const registry = new PluginRegistry([
      { manifest: { id: 'demo', name: 'Demo', version: '1.0.0', presets: [{ id: 'default', name: 'Default', tools: ['readFile'] }] } } as any,
    ]);
    const adapter = new ServerPluginAdapter(registry);

    adapter.enablePreset('demo/default');

    expect(adapter.listPlugins()).toHaveLength(1);
    expect(adapter.listPresets()).toHaveLength(1);
    expect(adapter.getActiveCapabilities().tools).toContain('readFile');
  });
});
```

- [ ] **Step 2: Run the server plugin adapter test to verify it fails**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/server/plugins-adapter.test.ts`
Expected: FAIL because adapter module does not exist.

- [ ] **Step 3: Implement the smallest plugin server adapter**

In `src/core/server/plugins/adapter.ts`, add methods:
- `listPlugins()`
- `listPresets()`
- `enablePreset(id)`
- `disablePreset(id)`
- `getActiveCapabilities()`

- [ ] **Step 4: Run the server plugin adapter test to verify it passes**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/server/plugins-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Run the plugin suite together**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/core/plugins/loader.test.ts tests/core/plugins/registry.test.ts tests/core/server/plugins-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the plugin adapter slice**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add src/core/server/plugins/adapter.ts tests/core/server/plugins-adapter.test.ts tests/core/plugins/loader.test.ts tests/core/plugins/registry.test.ts
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "feat(server): add declarative plugin adapter"
```

---

### Task 10: Final verification and cleanup

**Files:**
- Modify only if needed: `docs/superpowers/specs/2026-03-18-server-harness-plugin-design.md`
- Verify: all touched files above

- [ ] **Step 1: Run the build before claiming completion**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npm run build`
Expected: PASS

- [ ] **Step 2: Run the complete focused regression suite**

Run: `cd "C:/mntd/code/Meshy/.worktrees/runtime-core" && npx vitest run tests/cli/server-command.test.ts tests/core/harness/artifact-store.test.ts tests/core/harness/fixture-recorder.test.ts tests/core/harness/failure-attributor.test.ts tests/core/harness/scoring.test.ts tests/core/harness/evaluation-service.test.ts tests/core/harness/harness-e2e.test.ts tests/core/harness/server-adapter.test.ts tests/core/plugins/loader.test.ts tests/core/plugins/registry.test.ts tests/core/server/plugins-adapter.test.ts tests/core/session/replay.test.ts tests/core/session/replay-compat.test.ts`
Expected: all PASS

- [ ] **Step 3: Update the spec only if implementation forced a real design change**

Keep the spec in sync if file locations, contracts, or scope changed materially.

- [ ] **Step 4: Commit any final cleanup**

```bash
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" add <only changed files>
git -C "C:/mntd/code/Meshy/.worktrees/runtime-core" commit -m "chore: finalize server harness plugin rollout"
```

---

## TDD notes for the implementer

- Do not write production code before the failing test for that slice exists.
- Keep each task narrowly scoped and commit after the green state for that slice.
- Prefer `npx vitest run <specific files>` over inventing a new global test script unless it becomes necessary.
- Treat the command rename as a user-facing startup command change, not a broad internal naming rewrite.
- Keep plugin v1 declarative: manifests, preset state, and a thin server adapter only. Do not wire plugin activation into every existing capability registry in this plan.
- The end-to-end harness test is required; do not mark the harness complete without replay → fixture → evaluation → attribution coverage.

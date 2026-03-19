# Server, Harness, and Plugin Productization Design

Date: 2026-03-18
Status: Draft approved in conversation, pending spec review loop

## Summary

This design unifies Meshy's product surface around `server`, extracts harness functionality into a dedicated domain service, and introduces a plugin + preset architecture inspired by Claude Code style capability packaging.

The goal is to make three product-facing capabilities work together behind a single runtime surface:

1. `server` as the primary product term and external runtime entrypoint
2. `harness` as a standalone domain for replay-driven fixtures, evaluation, and failure attribution
3. `plugins + presets` as an extensibility layer for packaging tools, agents, skills, and MCP servers

The implementation should be phased to avoid high-blast-radius refactors while still creating a clean long-term product architecture.

---

## 1. Server command naming

### Decision

Rename the user-facing command that starts the current webserver-style daemon flow from `daemon` to `server`.

This is a command-level product naming change, not a broad architectural redefinition of the entire runtime surface.

### Why

The current startup flow behaves like the `server` command in products such as OpenCode: it starts a webserver-oriented process and exposes a product-facing service entrypoint. Calling that command `server` is clearer than calling it `daemon`.

### Scope

In scope for v1:
- rename the user-facing startup command from `daemon` to `server`
- update command help text, docs, and product-facing references tied to that startup path
- keep compatibility for existing `daemon` usage during transition if needed

Out of scope for v1:
- repo-wide renaming of all internal `daemon` identifiers
- immediate directory moves or import path churn
- reframing every runtime subsystem under a new `server` abstraction

### Migration strategy

#### Phase A
- add or switch to the `server` command for the webserver startup path
- update docs and user-facing command descriptions
- keep `daemon` as a compatibility alias if migration cost is low

#### Phase B
- gradually clean up related naming in adjacent adapters or docs where it directly improves clarity
- defer broad internal renames unless they become necessary during later refactors

### Non-goals for this phase
- no repo-wide rename of `daemon`
- no high-risk import churn
- no behavior changes outside the startup command surface

---

## 2. Harness service architecture

### Goal

Move replay, fixture recording, evaluation, and failure attribution into an explicit harness domain service under `src/core/harness/`, rather than leaving them spread across runtime and daemon-adjacent code.

### Module boundaries

#### `src/core/harness/artifacts/`
Owns artifact schemas and persistence.

Suggested files:
- `types.ts`
- `artifact-store.ts`

Responsibilities:
- store fixtures, runs, and reports under `.meshy/harness/`
- centralize naming, metadata, and load/save rules
- prevent daemon/server layers from hand-building file paths

#### `src/core/harness/fixtures/`
Owns replay-to-fixture recording.

Suggested files:
- `fixture-recorder.ts`

Responsibilities:
- consume `ReplayExport`
- create `ScenarioFixture`
- include replay identity, goal, environment summary, expected assertions
- only support replay-recorded fixtures in v1

#### `src/core/harness/evaluation/`
Owns evaluation execution and scoring.

Suggested files:
- `evaluation-service.ts`
- `scoring.ts`

Responsibilities:
- run a fixture
- return binary pass/fail plus lightweight scores
- keep transport details out of evaluation logic

Recommended v1 scores:
- `goalCompletion`
- `outputMatch`
- `toolUsageMatch`

#### `src/core/harness/attribution/`
Owns structured failure attribution.

Suggested files:
- `failure-attributor.ts`

Responsibilities:
- classify failed runs
- produce a short root-cause summary for product display

Recommended v1 types:
- `tool_error`
- `context_miss`
- `timeout`
- `sandbox_denied`
- `bad_output`
- `unknown`

#### `src/core/server/harness/` or `src/core/harness/server/adapter.ts`
Owns the server-facing harness adapter.

Responsibilities:
- map server requests to harness services
- return DTOs, status, and artifact references
- avoid holding harness business rules in the transport layer

### Core data models

Ownership:
- `ReplayExport` remains owned by `src/core/session/replay.ts`
- harness-owned contracts live under `src/core/harness/artifacts/types.ts`

```ts
interface FixtureExpectation {
  finalStatus?: 'passed' | 'failed';
  outputMarkers?: string[];
  requiredTools?: string[];
}
```

```ts
interface ScenarioFixture {
  schemaVersion: 1;
  id: string;
  title: string;
  sourceReplayId: string;
  createdAt: string;
  goal?: string;
  environment?: {
    workspaceRoot?: string;
    openFiles?: string[];
  };
  expected: FixtureExpectation;
  replay: ReplayExport;
}
```

```ts
interface FailureAttribution {
  type:
    | 'tool_error'
    | 'context_miss'
    | 'timeout'
    | 'sandbox_denied'
    | 'bad_output'
    | 'unknown';
  summary: string;
}
```

```ts
interface HarnessScoreBreakdown {
  goalCompletion: number;
  outputMatch: number;
  toolUsageMatch: number;
}
```

```ts
interface HarnessRunRecord {
  schemaVersion: 1;
  id: string;
  fixtureId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'passed' | 'failed';
  scores: HarnessScoreBreakdown;
  attribution?: FailureAttribution;
}
```

```ts
interface HarnessReport {
  schemaVersion: 1;
  id: string;
  fixtureId: string;
  runId: string;
  createdAt: string;
  status: 'passed' | 'failed';
  scores: HarnessScoreBreakdown;
  attribution?: FailureAttribution;
  summary: string;
}
```

```ts
interface HarnessRunResult {
  runId: string;
  reportId?: string;
  status: 'passed' | 'failed';
  scores: HarnessScoreBreakdown;
  attribution?: FailureAttribution;
}
```

`HarnessRunResult.reportId` is populated whenever a `HarnessReport` artifact is persisted. In v1, report persistence is required for both passed and failed runs so server callers can always resolve a stable report artifact after evaluation.

### Artifact persistence contract

All harness artifacts are JSON files under `.meshy/harness/`.

Directory layout:
- `.meshy/harness/fixtures/<fixture-id>.json`
- `.meshy/harness/runs/<run-id>.json`
- `.meshy/harness/reports/<report-id>.json`

Rules:
- all persisted harness artifacts include `schemaVersion: 1`
- artifact ids are opaque string ids generated by the harness layer
- file naming is `<artifact-id>.json`
- future schema changes must be handled by additive normalization where possible
- v1 does not include a separate migration command; compatibility is preserved by loader normalization and schema version checks

### Scoring and pass/fail contract

All scores are normalized to the range `0..1`.

V1 scoring rules:
- `goalCompletion`: `1` when expected final status and required outcome are satisfied, otherwise `0`
- `outputMatch`: fraction of `expected.outputMarkers` found in the evaluated output; `1` when there are no output markers configured
- `toolUsageMatch`: fraction of `expected.requiredTools` observed in the run; `1` when there are no required tools configured

V1 pass/fail rule:
- a run is `passed` only when all configured expectations are satisfied
- scores are always returned, even for failed runs
- attribution is attached only for failed runs or execution-level errors

### Interface sketch

```ts
interface HarnessArtifactStore {
  saveFixture(fixture: ScenarioFixture): Promise<string>;
  loadFixture(id: string): Promise<ScenarioFixture | null>;
  saveRun(run: HarnessRunRecord): Promise<string>;
  loadRun(id: string): Promise<HarnessRunRecord | null>;
  saveReport(report: HarnessReport): Promise<string>;
  loadReport(id: string): Promise<HarnessReport | null>;
}
```

```ts
interface FixtureRecorder {
  recordFromReplay(
    replay: ReplayExport,
    options?: { title?: string; expected?: FixtureExpectation }
  ): Promise<ScenarioFixture>;
}
```

```ts
interface EvaluationService {
  runFixture(fixture: ScenarioFixture): Promise<HarnessRunResult>;
}
```

```ts
interface FailureAttributor {
  attribute(input: {
    replay?: ReplayExport;
    run: HarnessRunRecord;
    error?: Error;
  }): FailureAttribution;
}
```

### Data flow

#### Recording
`ReplayExport` → `FixtureRecorder` → `ScenarioFixture` → `ArtifactStore`

#### Evaluation
`ScenarioFixture` → `EvaluationService` → `HarnessRunRecord` → `FailureAttributor` → `ArtifactStore` → `server result`

### Error handling

#### Fixture recording failure
- return structured errors for malformed or incompatible replay input
- do not write half-formed fixture artifacts

#### Evaluation failure
- convert execution failures into structured run results
- use attribution to classify failure instead of surfacing raw crashes as the primary result
- failure is a first-class evaluation outcome, not just an exception

#### Attribution uncertainty
- fall back to `unknown`
- provide a short summary directing users to the run artifact for deeper inspection

### Acceptance criteria

#### Functional
- can record fixtures from existing replays
- can persist fixtures under `.meshy/harness/fixtures/`
- can evaluate a single fixture
- returns `passed/failed`, scores, failure type, and summary
- stores run/report artifacts for later review
- does not break old replay compatibility

#### Engineering
- harness logic lives under `src/core/harness/`
- transport layer remains an adapter
- at least one end-to-end test covers replay → fixture → evaluation → attribution

#### Product
- real sessions can become reusable regression samples
- failures are no longer black boxes
- the design can grow into multi-scenario regression and richer scoring later

---

## 3. Plugin and preset architecture

### Goal

Support a Claude Code + superpowers style extension model where plugins add capabilities and presets package them into user-facing working modes.

### Core idea

A plugin declares what it contributes. A preset declares how to activate a useful subset or bundle of those capabilities.

Preset ownership in v1 is plugin-local:
- every preset belongs to exactly one plugin manifest
- the registry exposes presets using a composite identity: `<plugin-id>/<preset-id>`
- presets are not standalone top-level installable objects in v1

### Module boundaries

#### `src/core/plugins/manifest.ts`
Owns plugin manifest schema.

V1 plugins are declarative metadata only and cannot execute arbitrary third-party code.

```ts
interface MeshyPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  tools?: string[];
  mcpServers?: string[];
  agents?: string[];
  skills?: string[];
  presets?: MeshyPluginPreset[];
}

interface MeshyPluginPreset {
  id: string;
  name: string;
  description?: string;
  tools?: string[];
  mcpServers?: string[];
  agents?: string[];
  skills?: string[];
}
```

#### `src/core/plugins/loader.ts`
Owns local plugin discovery and manifest loading.

Responsibilities:
- scan plugin directories
- read manifests
- validate required fields
- return loadable plugin descriptors

V1 scope:
- local plugins only
- no marketplace downloads

#### `src/core/plugins/registry.ts`
Owns plugin and preset registration.

Responsibilities:
- list installed plugins
- list available presets
- resolve preset contents
- own active preset state for the current server runtime

V1 activation semantics:
- active preset state is maintained in the server process memory
- activation state is ephemeral and scoped to the current server process; restart clears enabled presets unless a later phase adds persistence
- enabling a preset adds its declared capabilities into the active capability set
- disabling a preset removes only that preset's contributed capabilities, then recomputes the merged active set from remaining enabled presets
- duplicate capabilities from multiple presets are deduplicated by identifier
- conflicts are resolved by set union in v1; there is no priority override system yet

#### `src/core/plugins/presets/tool-preset.ts`
Owns preset expansion.

Responsibilities:
- flatten tools, skills, agents, and MCP server declarations
- deduplicate outputs
- perform light validation

#### `src/core/server/plugins/adapter.ts`
Owns server-facing plugin APIs.

Responsibilities:
- list plugins
- list presets
- enable preset
- disable preset
- expose active capability sets to server/runtime

### Data flow

`plugin manifests` → `PluginLoader` → `PluginRegistry` → `PresetResolver` → `ServerPluginAdapter` → active capability set

### Why presets matter

Without presets, plugins are just bags of features. Presets turn those features into coherent working modes and are the closest analogue to the superpowers experience.

### Trust and validation model

V1 plugins are declarative and local-only.

Rules:
- the plugin manifest is metadata, not arbitrary executable plugin logic
- manifests are validated for required fields, identifier shape, and duplicate preset ids within the same plugin
- only locally installed plugins from configured plugin directories are loaded
- enabling a preset activates already-supported server/runtime capabilities by identifier; it does not execute arbitrary third-party code in v1

### V1 non-goals
- remote marketplace download/install
- plugin sandbox execution
- plugin dependency graphs
- semver negotiation
- auto-update
- signature/trust model
- GUI plugin store

### V1 acceptance criteria
- can discover at least one local plugin
- can parse at least one preset from that plugin
- can enable a preset
- enabled preset changes the capability set available to the server

---

## 4. Phased implementation roadmap

### Phase 1 — Product terminology converges on `server`

Goal: unify product language first, without triggering high-risk refactors.

Work:
- use `server` in docs, interfaces, and new adapters
- keep `daemon` compatibility in place

Success:
- product-facing language is primarily `server`
- no major runtime breakage from naming work

### Phase 2 — Harness core extraction

Goal: establish `src/core/harness/` as a domain service.

Work:
- add harness types
- build artifact store
- build fixture recorder
- build failure attributor
- build evaluation service

Success:
- replay → fixture → run → attribution works for a single scenario
- artifacts are persisted

### Phase 3 — Server-to-harness integration

Goal: make harness available from the product entrypoint.

Work:
- add harness server adapter
- expose create fixture / run fixture / query run / query report functionality
- return `HarnessRunResult` to callers while persisting `HarnessRunRecord` and `HarnessReport`

Success:
- product entrypoints do not need direct internal harness calls
- server returns structured harness results
- run and report lookup operate on persisted artifact ids

### Phase 4 — Plugin and preset foundation

Goal: enable local plugin discovery and preset activation.

Work:
- manifest schema
- plugin loader
- plugin registry
- preset resolver
- server plugin adapter
- in-memory active preset tracking for the running server

Success:
- at least one local plugin can be discovered
- at least one preset can be enabled
- enabled preset affects active server capabilities
- disabling a preset recomputes the merged active capability set correctly

### Phase 5 — Regression and product hardening

Goal: make the system durable enough for continued productization.

Work:
- replay compatibility regression tests
- harness end-to-end tests
- plugin preset regression checks
- gradual cleanup of remaining `daemon` naming where appropriate

Success:
- replay / fixture / preset compatibility is protected by tests
- the architecture is ready for batch evals, richer scoring, marketplace work, and UI layers later

---

## Recommended implementation order

1. converge on `server` terminology externally
2. extract harness core
3. integrate harness through a server adapter
4. add plugin + preset foundation
5. harden with regression coverage and naming cleanup

This order keeps risk low while ensuring each stage creates a usable product-facing improvement.

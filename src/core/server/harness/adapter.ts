import { HarnessArtifactStore } from '../../harness/artifacts/artifact-store.js';
import type { FixtureExpectation, HarnessRunResult } from '../../harness/artifacts/types.js';
import { EvaluationService } from '../../harness/evaluation/evaluation-service.js';
import { FixtureRecorder } from '../../harness/fixtures/fixture-recorder.js';
import { loadReplay } from '../../session/replay.js';

export class HarnessServerAdapter {
    private readonly store: HarnessArtifactStore;
    private readonly recorder = new FixtureRecorder();
    private readonly evaluation: EvaluationService;

    constructor(private readonly workspaceRoot: string) {
        this.store = new HarnessArtifactStore(workspaceRoot);
        this.evaluation = new EvaluationService(this.store);
    }

    async createFixtureFromReplay(
        replayPath: string,
        options: { title?: string; expected?: FixtureExpectation } = {},
    ): Promise<{ fixtureId: string }> {
        const replay = loadReplay(replayPath);
        if (!replay) {
            throw new Error(`Failed to load replay from ${replayPath}`);
        }

        const fixture = await this.recorder.recordFromReplay(replay, options);
        await this.store.saveFixture(fixture);
        return { fixtureId: fixture.id };
    }

    async runFixture(fixtureId: string): Promise<HarnessRunResult> {
        const fixture = await this.store.loadFixture(fixtureId);
        if (!fixture) {
            throw new Error(`Fixture not found: ${fixtureId}`);
        }

        return this.evaluation.runFixture(fixture);
    }

    async getRun(runId: string) {
        return this.store.loadRun(runId);
    }

    async getReport(reportId: string) {
        return this.store.loadReport(reportId);
    }
}

import { randomUUID } from 'crypto';
import { HarnessArtifactStore } from '../artifacts/artifact-store.js';
import type { HarnessReport, HarnessRunRecord, HarnessRunResult, ScenarioFixture } from '../artifacts/types.js';
import { FailureAttributor } from '../attribution/failure-attributor.js';
import { scoreFixtureRun } from './scoring.js';

export class EvaluationService {
    constructor(
        private readonly store: HarnessArtifactStore,
        private readonly attributor: FailureAttributor = new FailureAttributor(),
    ) {}

    async runFixture(fixture: ScenarioFixture): Promise<HarnessRunResult> {
        const outputText = fixture.replay.steps
            .filter(step => step.type === 'text')
            .map(step => String(step.raw ?? step.summary))
            .join('\n');

        const toolNames = fixture.replay.steps
            .filter(step => step.type === 'tool_call')
            .map(step => {
                const raw = step.raw as { name?: string } | undefined;
                return raw?.name ?? '';
            })
            .filter(Boolean);

        const scores = scoreFixtureRun(fixture, {
            outputText,
            toolNames,
            finalStatus: 'passed',
        });

        const passed = scores.goalCompletion === 1 && scores.outputMatch === 1 && scores.toolUsageMatch === 1;
        const runId = randomUUID();
        const reportId = randomUUID();
        const finishedAt = new Date().toISOString();

        const run: HarnessRunRecord = {
            schemaVersion: 1,
            id: runId,
            fixtureId: fixture.id,
            startedAt: finishedAt,
            finishedAt,
            status: passed ? 'passed' : 'failed',
            scores,
        };

        if (!passed) {
            run.attribution = this.attributor.attribute({ run });
        }

        const report: HarnessReport = {
            schemaVersion: 1,
            id: reportId,
            fixtureId: fixture.id,
            runId,
            createdAt: finishedAt,
            status: run.status,
            scores,
            attribution: run.attribution,
            summary: passed
                ? 'Fixture passed all configured expectations.'
                : (run.attribution?.summary ?? 'Fixture failed its configured expectations.'),
            runtimeDecisions: fixture.replay.runtimeDecisions ?? [],
        };

        await this.store.saveRun(run);
        await this.store.saveReport(report);

        return {
            runId,
            reportId,
            status: run.status,
            scores,
            attribution: run.attribution,
        };
    }
}

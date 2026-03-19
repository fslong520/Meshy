import type { ReplayExport } from '../../session/replay.js';
import type { FixtureExpectation, ScenarioFixture } from '../artifacts/types.js';

export class FixtureRecorder {
    async recordFromReplay(
        replay: ReplayExport,
        options: { title?: string; expected?: FixtureExpectation } = {},
    ): Promise<ScenarioFixture> {
        return {
            schemaVersion: 1,
            id: `fixture-${replay.sessionId}`,
            title: options.title ?? replay.session.title ?? replay.sessionId,
            sourceReplayId: replay.sessionId,
            createdAt: new Date().toISOString(),
            goal: replay.blackboard.currentGoal || undefined,
            environment: {
                openFiles: replay.blackboard.openFiles,
            },
            expected: options.expected ?? {},
            replay,
        };
    }
}

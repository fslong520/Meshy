import type { HarnessReport } from '../artifacts/types.js';
import { diffRuntimeDecisions } from './runtime-decisions.js';
import { attributeRuntimeDecisionDiff } from './runtime-attribution.js';

export interface HarnessComparisonArtifact {
    beforeStatus: 'passed' | 'failed';
    afterStatus: 'passed' | 'failed';
    statusChanged: boolean;
    scoreDelta: {
        goalCompletion: number;
        outputMatch: number;
        toolUsageMatch: number;
    };
    runtimeDecisionDiff: ReturnType<typeof diffRuntimeDecisions>;
    runtimeAttribution: ReturnType<typeof attributeRuntimeDecisionDiff>;
}

export function compareHarnessReports(before: HarnessReport, after: HarnessReport): HarnessComparisonArtifact {
    const runtimeDecisionDiff = diffRuntimeDecisions(before, after);
    const runtimeAttribution = attributeRuntimeDecisionDiff(runtimeDecisionDiff);

    return {
        beforeStatus: before.status,
        afterStatus: after.status,
        statusChanged: before.status !== after.status,
        scoreDelta: {
            goalCompletion: after.scores.goalCompletion - before.scores.goalCompletion,
            outputMatch: after.scores.outputMatch - before.scores.outputMatch,
            toolUsageMatch: after.scores.toolUsageMatch - before.scores.toolUsageMatch,
        },
        runtimeDecisionDiff,
        runtimeAttribution,
    };
}

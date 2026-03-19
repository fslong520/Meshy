import type { FixtureExpectation, HarnessScoreBreakdown } from '../artifacts/types.js';

export function scoreFixtureRun(
    fixture: { expected: FixtureExpectation },
    observation: { outputText: string; toolNames: string[]; finalStatus?: 'passed' | 'failed' },
): HarnessScoreBreakdown {
    const outputMarkers = fixture.expected.outputMarkers ?? [];
    const requiredTools = fixture.expected.requiredTools ?? [];

    const outputMatch = outputMarkers.length === 0
        ? 1
        : outputMarkers.filter(marker => observation.outputText.includes(marker)).length / outputMarkers.length;

    const toolUsageMatch = requiredTools.length === 0
        ? 1
        : requiredTools.filter(tool => observation.toolNames.includes(tool)).length / requiredTools.length;

    const goalCompletion = fixture.expected.finalStatus
        ? (fixture.expected.finalStatus === observation.finalStatus ? 1 : 0)
        : (outputMatch === 1 && toolUsageMatch === 1 ? 1 : 0);

    return {
        goalCompletion,
        outputMatch,
        toolUsageMatch,
    };
}

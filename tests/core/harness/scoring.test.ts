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

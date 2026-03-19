import { describe, expect, it } from 'vitest';
import { FailureAttributor } from '../../../src/core/harness/attribution/failure-attributor.js';

describe('FailureAttributor', () => {
    it('classifies tool failures as tool_error with a summary', () => {
        const attributor = new FailureAttributor();
        const result = attributor.attribute({
            run: {
                schemaVersion: 1,
                id: 'run-1',
                fixtureId: 'fx-1',
                startedAt: '2026-03-18T00:00:00.000Z',
                status: 'failed',
                scores: { goalCompletion: 0, outputMatch: 0, toolUsageMatch: 0 },
            },
            error: new Error('Tool bash failed with exit code 1'),
        });

        expect(result.type).toBe('tool_error');
        expect(result.summary).toContain('Tool');
    });
});

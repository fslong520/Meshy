import type { FailureAttribution, HarnessRunRecord } from '../artifacts/types.js';

export class FailureAttributor {
    attribute(input: { run: HarnessRunRecord; error?: Error }): FailureAttribution {
        const message = input.error?.message ?? '';

        if (/tool/i.test(message)) {
            return {
                type: 'tool_error',
                summary: `Tool execution failed: ${message}`,
            };
        }

        if (/timeout/i.test(message)) {
            return {
                type: 'timeout',
                summary: `The evaluation timed out: ${message}`,
            };
        }

        if (/sandbox|permission|denied/i.test(message)) {
            return {
                type: 'sandbox_denied',
                summary: `The evaluation was blocked by sandbox or permission rules: ${message}`,
            };
        }

        if (input.run.status === 'failed') {
            return {
                type: 'bad_output',
                summary: 'The evaluated result did not satisfy the fixture expectations.',
            };
        }

        return {
            type: 'unknown',
            summary: 'The run failed and no reliable attribution rule matched the failure.',
        };
    }
}

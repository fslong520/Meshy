import { z } from 'zod';
import { defineTool } from '../define.js';
import { terminalManager } from '../../terminal/manager.js';

export const CommandStatusTool = defineTool('command_status', {
    description: [
        'Get the status and sliding window logs of a previously executed background terminal command.',
        'Use this to fetch the stdout/stderr stream from long-running services (e.g. debugging a backend crash).',
    ].join('\n'),
    parameters: z.object({
        CommandId: z.string().describe('ID of the command to get status for.'),
        OutputCharacterCount: z.number().describe('Number of characters to load from the recent log buffer. Max is usually 10000.').optional()
    }),
    async execute(params) {
        const status = terminalManager.getProcessStatus(params.CommandId);

        if (!status) {
            return {
                output: `CommandId ${params.CommandId} not found in the active terminal manager. The process may have been completely purged or the ID is incorrect.`
            };
        }

        const outputChars = params.OutputCharacterCount || 5000;
        const logs = terminalManager.getProcessOutput(params.CommandId, outputChars);

        return {
            output: `Status: ${status.status}\nExit Code: ${status.exitCode !== null ? status.exitCode : 'N/A'}\n\n--- RECENT LOGS ---\n\n${logs}`,
            metadata: {
                status: status.status,
                exitCode: status.exitCode
            }
        };
    }
});

import { z } from 'zod';
import { defineTool } from '../define.js';
import { terminalManager } from '../../terminal/manager.js';

export const SendCommandInputTool = defineTool('send_command_input', {
    description: [
        'Send standard input to a running background command or terminate it.',
        'Use this to interact with REPLs, interactive scripts, or long-running processes.',
    ].join('\n'),
    parameters: z.object({
        CommandId: z.string().describe('The command ID from a previous run_command call.'),
        Input: z.string().describe('The text to send to stdin. Include newline (\\n) if you want to submit/press Enter. Leave empty if purely terminating.').optional(),
        Terminate: z.boolean().describe('Set to true to forcibly kill the process instead of sending input.').optional()
    }),
    manifest: {
        permissionClass: 'exec',
    },
    async execute(params) {
        const { CommandId, Input, Terminate } = params;

        // Validation for missing inputs
        if (!Input && !Terminate) {
            return { output: "You must provide either 'Input' or 'Terminate: true'" };
        }

        const status = terminalManager.getProcessStatus(CommandId);
        if (!status) {
            return {
                output: `Error: CommandId ${CommandId} not found. It may have been purged.`
            };
        }

        if (status.status !== 'running') {
            return {
                output: `Command is no longer running. Current status is: ${status.status}. Exit code: ${status.exitCode}`
            };
        }

        if (Terminate) {
            const success = terminalManager.killProcess(CommandId);
            return {
                output: success
                    ? `Successfully sent SIGTERM to CommandId ${CommandId}.`
                    : `Failed to terminate CommandId ${CommandId}.`
            };
        }

        if (Input) {
            const success = terminalManager.sendInput(CommandId, Input);
            return {
                output: success
                    ? `Successfully sent input to CommandId ${CommandId}. Use 'command_status' tool to see the resulting output.`
                    : `Failed to send input. The process stdin might be closed.`
            };
        }

        return { output: "Unexpected error handling input" };
    }
});

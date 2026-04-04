import { z } from 'zod';
import { defineTool } from '../define.js';
import { terminalManager } from '../../terminal/manager.js';

export const RunCommandTool = defineTool('run_command', {
    description: [
        'Run a command asynchronously in the background.',
        'Supports multiple concurrent terminal instances (e.g., Frontend Dev Server, Backend API, Jest Watch).',
        'Unlike `bash`, this does NOT block. It immediately returns a `CommandId`.',
        'Use `command_status` tool with the returned ID to read its scrolling logs.',
    ].join('\n'),
    parameters: z.object({
        command: z.string().describe('The command line string to execute.'),
        cwd: z.string().describe('The current working directory. Defaults to workspace root.'),
    }),
    manifest: {
        permissionClass: 'exec',
    },
    async execute(params, ctx) {
        const cwd = params.cwd || ctx.workspaceRoot;
        try {
            const id = terminalManager.startProcess(params.command, cwd);

            // Wait briefly to catch immediate execution failures (e.g., non-existent command, syntax error)
            await new Promise(resolve => setTimeout(resolve, 500));

            const status = terminalManager.getProcessStatus(id);
            if (status && status.status === 'exited' && status.exitCode !== 0) {
                const logs = terminalManager.getProcessOutput(id, 2000);
                return {
                    output: `Process exited immediately with code ${status.exitCode}.\\n\\nOutput Logs:\\n${logs}`,
                    isError: true,
                    metadata: { id, exitCode: status.exitCode }
                };
            }

            // 将进程状态持久化到 Session 中
            if (ctx.session) {
                if (!ctx.session.backgroundProcesses) {
                    ctx.session.backgroundProcesses = [];
                }
                ctx.session.backgroundProcesses.push({
                    id,
                    command: params.command,
                    cwd,
                    startedAt: new Date().toISOString()
                });
            }

            return {
                output: `Process started successfully.\nCommandId: ${id}\nUse the 'command_status' tool to continuously poll output logs from this service.`,
                metadata: { id }
            };
        } catch (error: any) {
            return {
                output: `Failed to start background process: ${error.message}`,
                isError: true
            };
        }
    }
});

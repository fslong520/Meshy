/**
 * Bash Tool — Shell 命令执行器
 *
 * 参考 OpenCode bash.ts，支持：
 * - Windows (cmd/powershell) + Unix (bash/sh) 双壳自动检测
 * - timeout 自动 kill
 * - stdout + stderr 合并输出
 * - 大输出自动截断
 */

import { z } from 'zod';
import { spawn } from 'child_process';
import { defineTool } from './define.js';

const MAX_OUTPUT_LENGTH = 30_000;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

function getDefaultShell(): string | boolean {
    return process.platform === 'win32' ? 'powershell.exe' : true;
}

export const BashTool = defineTool('bash', {
    description: [
        'Execute a shell command on the system.',
        'Use this to run commands, scripts, or programs.',
        'IMPORTANT RULES:',
        '- NEVER use `cd` — use the `workdir` parameter instead.',
        '- Commands run in a new shell each time, so state is not preserved between calls.',
        '- For long-running processes, set an appropriate timeout.',
        '- Always include a description of what the command does.',
    ].join('\n'),
    parameters: z.object({
        command: z.string().describe('The command to execute'),
        timeout: z.number().describe('Optional timeout in milliseconds').optional(),
        workdir: z.string().describe('The working directory. Defaults to workspace root. Use this instead of cd.').optional(),
        description: z.string().describe('A clear, concise description of what this command does in 5-10 words'),
    }),
    async execute(params, ctx) {
        const cwd = params.workdir || ctx.workspaceRoot;
        const timeout = params.timeout ?? DEFAULT_TIMEOUT_MS;

        if (timeout < 0) {
            return { output: `Invalid timeout value: ${timeout}. Must be positive.` };
        }

        const shell = getDefaultShell();

        return new Promise<{ output: string; metadata?: Record<string, unknown> }>((resolve) => {
            let output = '';
            let timedOut = false;

            const proc = spawn(params.command, {
                shell,
                cwd,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            const append = (chunk: Buffer) => {
                output += chunk.toString();
            };

            proc.stdout?.on('data', append);
            proc.stderr?.on('data', append);

            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
                setTimeout(() => proc.kill('SIGKILL'), 1000);
            }, timeout);

            proc.once('exit', (code) => {
                clearTimeout(timer);

                const parts: string[] = [];

                if (timedOut) {
                    parts.push(`<bash_metadata>\nCommand terminated after exceeding timeout ${timeout}ms\n</bash_metadata>\n`);
                }

                // 截断过长输出
                if (output.length > MAX_OUTPUT_LENGTH) {
                    parts.push(output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (output truncated)');
                } else {
                    parts.push(output);
                }

                resolve({
                    output: parts.join('\n'),
                    metadata: {
                        exit: code,
                        timedOut,
                        description: params.description,
                    },
                });
            });

            proc.once('error', (err) => {
                clearTimeout(timer);
                resolve({
                    output: `Failed to execute command: ${err.message}`,
                    metadata: { exit: -1 },
                });
            });
        });
    },
});

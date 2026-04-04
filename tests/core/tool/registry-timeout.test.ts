import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../../../src/core/tool/define.js';
import { ToolRegistry } from '../../../src/core/tool/registry.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ToolRegistry timeout policy', () => {
    it('returns timeout error when tool exceeds manifest timeout', async () => {
        const registry = new ToolRegistry();
        registry.register(defineTool('slow_tool', {
            description: 'slow tool',
            parameters: z.object({}),
            manifest: {
                permissionClass: 'exec',
                timeoutMs: 10,
            },
            async execute() {
                await sleep(30);
                return { output: 'done' };
            },
        }));

        const result = await registry.execute('slow_tool', {}, {
            sessionId: 's1',
            workspaceRoot: process.cwd(),
        });

        expect(result.isError).toBe(true);
        expect(result.output).toContain('timed out');
        expect(result.metadata?.timeoutMs).toBe(10);
    });

    it('allows tool completion when manifest timeout is null', async () => {
        const registry = new ToolRegistry();
        registry.register(defineTool('fast_tool', {
            description: 'fast tool',
            parameters: z.object({}),
            manifest: {
                permissionClass: 'read',
                timeoutMs: null,
            },
            async execute() {
                await sleep(5);
                return { output: 'ok' };
            },
        }));

        const result = await registry.execute('fast_tool', {}, {
            sessionId: 's2',
            workspaceRoot: process.cwd(),
        });

        expect(result.isError).not.toBe(true);
        expect(result.output).toBe('ok');
    });
});

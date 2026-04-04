import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../../../src/core/tool/define.js';
import { ToolRegistry } from '../../../src/core/tool/registry.js';

describe('ToolRegistry policy precheck', () => {
    it('blocks non-read permission classes in read-only policy mode', async () => {
        const registry = new ToolRegistry();
        registry.setPolicyMode('read_only');
        registry.register(defineTool('write_note', {
            description: 'writes data',
            parameters: z.object({}),
            manifest: {
                permissionClass: 'write',
            },
            async execute() {
                return { output: 'should not execute' };
            },
        }));

        const result = await registry.execute('write_note', {}, {
            sessionId: 'session-1',
            workspaceRoot: process.cwd(),
        });

        expect(result.isError).toBe(true);
        expect(result.output).toContain('blocked by read-only policy');
        expect(result.metadata?.policyMode).toBe('read_only');
        expect(result.metadata?.permissionClass).toBe('write');
        expect((result.metadata as any)?.policyDecision).toMatchObject({
            decision: 'deny',
            mode: 'read_only',
            permissionClass: 'write',
        });
    });

    it('allows read permission tools in read-only policy mode', async () => {
        const registry = new ToolRegistry();
        registry.setPolicyMode('read_only');
        registry.register(defineTool('read_note', {
            description: 'reads data',
            parameters: z.object({}),
            manifest: {
                permissionClass: 'read',
            },
            async execute() {
                return { output: 'safe read' };
            },
        }));

        const result = await registry.execute('read_note', {}, {
            sessionId: 'session-2',
            workspaceRoot: process.cwd(),
        });

        expect(result.isError).not.toBe(true);
        expect(result.output).toBe('safe read');
        expect((result.metadata as any)?.policyDecision).toMatchObject({
            decision: 'allow',
            mode: 'read_only',
            permissionClass: 'read',
        });
    });
});

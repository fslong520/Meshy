import { describe, expect, it } from 'vitest';
import { McpHostRuntime } from '../../../src/core/mcp/host.js';

describe('McpHostRuntime allowlist', () => {
    it('hides non-allowlisted servers from tools and blocks direct calls', async () => {
        const runtime = new McpHostRuntime(process.cwd());
        (runtime as any).servers.set('filesystem', {
            config: { name: 'filesystem', enabled: true },
            process: null,
            tools: [{ name: 'read_file', description: 'Read file', inputSchema: {} }],
            status: 'stopped',
            enabled: true,
        });
        (runtime as any).servers.set('playwright', {
            config: { name: 'playwright', enabled: true },
            process: null,
            tools: [{ name: 'open_page', description: 'Open page', inputSchema: {} }],
            status: 'stopped',
            enabled: true,
        });

        runtime.applyRuntimeAllowlist(['filesystem']);

        const tools = runtime.getAllTools(new Set(['filesystem', 'playwright']));
        expect(tools.some(t => t.name.includes('filesystem'))).toBe(true);
        expect(tools.some(t => t.name.includes('playwright'))).toBe(false);
        await expect(runtime.callTool('mcp:playwright:open_page', {})).rejects.toThrow('not currently allowed');
    });
});

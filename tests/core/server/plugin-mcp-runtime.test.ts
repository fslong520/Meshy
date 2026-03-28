import { describe, expect, it, vi } from 'vitest';
import { ServerPluginAdapter } from '../../../src/core/server/plugins/adapter.js';
import { PluginRegistry } from '../../../src/core/plugins/registry.js';

describe('ServerPluginAdapter MCP runtime activation', () => {
    it('enables presets, applies MCP projection to runtime, and saves the current projection explicitly', async () => {
        const registry = new PluginRegistry([
            {
                manifest: {
                    id: 'demo',
                    name: 'Demo',
                    version: '1.0.0',
                    presets: [{ id: 'default', name: 'Default', mcpServers: ['filesystem', 'typo'] }],
                },
            } as any,
        ]);
        const runtime = {
            getConfiguredServerNames: vi.fn().mockReturnValue(['filesystem', 'playwright']),
            applyRuntimeAllowlist: vi.fn(),
            getActiveRuntimeAllowlist: vi.fn().mockReturnValue(['filesystem']),
        };
        const saveProjectedMcpConfig = vi.fn().mockResolvedValue({ path: '/tmp/.agent/mcp.json', mcpServers: ['filesystem'] });
        const adapter = new ServerPluginAdapter(registry, runtime as any, saveProjectedMcpConfig as any);

        const enable = await adapter.enablePreset('demo/default');
        const save = await adapter.saveMcpProjection('/tmp');

        expect(runtime.applyRuntimeAllowlist).toHaveBeenCalledWith(['filesystem']);
        expect(enable.ignoredMcpServers).toEqual(['typo']);
        expect(save.mcpServers).toEqual(['filesystem']);
    });
});

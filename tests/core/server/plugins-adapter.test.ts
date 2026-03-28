import { describe, expect, it, vi } from 'vitest';
import { ServerPluginAdapter } from '../../../src/core/server/plugins/adapter.js';
import { PluginRegistry } from '../../../src/core/plugins/registry.js';

describe('ServerPluginAdapter', () => {
    it('lists plugins and toggles presets through the registry', async () => {
        const registry = new PluginRegistry([
            {
                manifest: {
                    id: 'demo',
                    name: 'Demo',
                    version: '1.0.0',
                    presets: [{ id: 'default', name: 'Default', tools: ['readFile'] }],
                },
            } as any,
        ]);
        const runtime = {
            getConfiguredServerNames: vi.fn().mockReturnValue([]),
            applyRuntimeAllowlist: vi.fn(),
            getActiveRuntimeAllowlist: vi.fn().mockReturnValue([]),
        };
        const saveProjectedMcpConfig = vi.fn();
        const adapter = new ServerPluginAdapter(registry, runtime as any, saveProjectedMcpConfig as any);

        await adapter.enablePreset('demo/default');

        expect(adapter.listPlugins()).toHaveLength(1);
        expect(adapter.listPresets()).toHaveLength(1);
        expect(adapter.getActiveCapabilities().tools).toContain('readFile');
    });
});

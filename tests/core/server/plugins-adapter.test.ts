import { describe, expect, it } from 'vitest';
import { ServerPluginAdapter } from '../../../src/core/server/plugins/adapter.js';
import { PluginRegistry } from '../../../src/core/plugins/registry.js';

describe('ServerPluginAdapter', () => {
    it('lists plugins and toggles presets through the registry', () => {
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
        const adapter = new ServerPluginAdapter(registry);

        adapter.enablePreset('demo/default');

        expect(adapter.listPlugins()).toHaveLength(1);
        expect(adapter.listPresets()).toHaveLength(1);
        expect(adapter.getActiveCapabilities().tools).toContain('readFile');
    });
});

import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../../src/core/plugins/registry.js';

describe('PluginRegistry', () => {
    it('enables and disables plugin-local presets using composite ids', () => {
        const registry = new PluginRegistry([
            {
                manifest: {
                    id: 'demo',
                    name: 'Demo',
                    version: '1.0.0',
                    presets: [
                        { id: 'default', name: 'Default', tools: ['readFile'], skills: ['code-review'] },
                        { id: 'mcp', name: 'MCP', mcpServers: ['filesystem'] },
                    ],
                },
            } as any,
        ]);

        registry.enablePreset('demo/default');
        expect(registry.getActiveCapabilities().tools).toContain('readFile');
        registry.enablePreset('demo/mcp');
        registry.disablePreset('demo/default');
        expect(registry.getActiveCapabilities().tools).not.toContain('readFile');
        expect(registry.getActiveCapabilities().mcpServers).toContain('filesystem');
    });
});

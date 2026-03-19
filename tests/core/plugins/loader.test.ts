import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginLoader } from '../../../src/core/plugins/loader.js';

describe('PluginLoader', () => {
    it('loads a local declarative plugin manifest', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-plugin-'));
        const pluginDir = path.join(root, 'demo');
        fs.mkdirSync(pluginDir, { recursive: true });
        fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
            id: 'demo',
            name: 'Demo Plugin',
            version: '1.0.0',
            presets: [{ id: 'default', name: 'Default', tools: ['readFile'] }],
        }), 'utf8');

        const loader = new PluginLoader([root]);
        const plugins = loader.loadAll();

        expect(plugins).toHaveLength(1);
        expect(plugins[0].manifest.id).toBe('demo');
    });
});

import fs from 'fs';
import path from 'path';
import { validatePluginManifest, type MeshyPluginManifest } from './manifest.js';

export interface LoadedPlugin {
    manifest: MeshyPluginManifest;
    pluginPath: string;
}

export class PluginLoader {
    constructor(private readonly roots: string[]) {}

    loadAll(): LoadedPlugin[] {
        const plugins: LoadedPlugin[] = [];

        for (const root of this.roots) {
            if (!fs.existsSync(root)) {
                continue;
            }

            for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                if (!entry.isDirectory()) {
                    continue;
                }

                const pluginPath = path.join(root, entry.name);
                const manifestPath = path.join(pluginPath, 'plugin.json');
                if (!fs.existsSync(manifestPath)) {
                    continue;
                }

                const manifest = validatePluginManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
                plugins.push({ manifest, pluginPath });
            }
        }

        return plugins;
    }
}

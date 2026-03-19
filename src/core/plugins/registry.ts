import type { LoadedPlugin } from './loader.js';
import type { MeshyPluginPreset } from './manifest.js';
import { resolveActiveCapabilities, type ActiveCapabilities } from './presets/tool-preset.js';

export class PluginRegistry {
    private readonly plugins: LoadedPlugin[];
    private readonly enabledPresetIds = new Set<string>();

    constructor(plugins: LoadedPlugin[]) {
        this.plugins = plugins;
    }

    listPlugins(): LoadedPlugin[] {
        return this.plugins;
    }

    listPresets(): Array<{ id: string; pluginId: string; preset: MeshyPluginPreset }> {
        return this.plugins.flatMap(plugin =>
            (plugin.manifest.presets ?? []).map(preset => ({
                id: `${plugin.manifest.id}/${preset.id}`,
                pluginId: plugin.manifest.id,
                preset,
            })),
        );
    }

    enablePreset(id: string): void {
        this.enabledPresetIds.add(id);
    }

    disablePreset(id: string): void {
        this.enabledPresetIds.delete(id);
    }

    getActiveCapabilities(): ActiveCapabilities {
        const presets = this.listPresets()
            .filter(entry => this.enabledPresetIds.has(entry.id))
            .map(entry => entry.preset);

        return resolveActiveCapabilities(presets);
    }
}

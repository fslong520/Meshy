import { PluginRegistry } from '../../plugins/registry.js';

export class ServerPluginAdapter {
    constructor(private readonly registry: PluginRegistry) {}

    listPlugins() {
        return this.registry.listPlugins();
    }

    listPresets() {
        return this.registry.listPresets();
    }

    enablePreset(id: string): void {
        this.registry.enablePreset(id);
    }

    disablePreset(id: string): void {
        this.registry.disablePreset(id);
    }

    getActiveCapabilities() {
        return this.registry.getActiveCapabilities();
    }
}

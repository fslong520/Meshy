import { PluginRegistry } from '../../plugins/registry.js';
import { projectActiveMcpServers } from '../../plugins/runtime/mcp-projection.js';

export class ServerPluginAdapter {
    constructor(
        private readonly registry: PluginRegistry,
        private readonly mcpRuntime: {
            getConfiguredServerNames(): string[];
            applyRuntimeAllowlist(serverNames: string[]): void;
            getActiveRuntimeAllowlist(): string[];
        },
        private readonly saveProjectedMcpConfig: (input: { workspaceRoot: string; activeMcpServers: string[] }) => Promise<{ path: string; mcpServers: string[] }>,
    ) {}

    listPlugins() {
        return this.registry.listPlugins();
    }

    listPresets() {
        return this.registry.listPresets();
    }

    getActiveCapabilities() {
        return this.registry.getActiveCapabilities();
    }

    getActiveMcpProjection() {
        return { mcpServers: this.mcpRuntime.getActiveRuntimeAllowlist() };
    }

    async enablePreset(id: string) {
        this.registry.enablePreset(id);
        return this.syncMcpProjection();
    }

    async disablePreset(id: string) {
        this.registry.disablePreset(id);
        return this.syncMcpProjection();
    }

    async saveMcpProjection(workspaceRoot: string) {
        return this.saveProjectedMcpConfig({
            workspaceRoot,
            activeMcpServers: this.mcpRuntime.getActiveRuntimeAllowlist(),
        });
    }

    private async syncMcpProjection() {
        const projection = projectActiveMcpServers({
            activeCapabilities: this.registry.getActiveCapabilities(),
            configuredServers: this.mcpRuntime.getConfiguredServerNames(),
        });
        this.mcpRuntime.applyRuntimeAllowlist(projection.mcpServers);
        return {
            capabilities: this.registry.getActiveCapabilities(),
            mcpServers: projection.mcpServers,
            ignoredMcpServers: projection.ignored,
        };
    }
}

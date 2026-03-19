import type { MeshyPluginPreset } from '../manifest.js';

export interface ActiveCapabilities {
    tools: string[];
    mcpServers: string[];
    agents: string[];
    skills: string[];
}

export function resolveActiveCapabilities(presets: MeshyPluginPreset[]): ActiveCapabilities {
    const tools = new Set<string>();
    const mcpServers = new Set<string>();
    const agents = new Set<string>();
    const skills = new Set<string>();

    for (const preset of presets) {
        for (const value of preset.tools ?? []) tools.add(value);
        for (const value of preset.mcpServers ?? []) mcpServers.add(value);
        for (const value of preset.agents ?? []) agents.add(value);
        for (const value of preset.skills ?? []) skills.add(value);
    }

    return {
        tools: Array.from(tools),
        mcpServers: Array.from(mcpServers),
        agents: Array.from(agents),
        skills: Array.from(skills),
    };
}

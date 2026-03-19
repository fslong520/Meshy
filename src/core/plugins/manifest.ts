export interface MeshyPluginPreset {
    id: string;
    name: string;
    description?: string;
    tools?: string[];
    mcpServers?: string[];
    agents?: string[];
    skills?: string[];
}

export interface MeshyPluginManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    tools?: string[];
    mcpServers?: string[];
    agents?: string[];
    skills?: string[];
    presets?: MeshyPluginPreset[];
}

export function validatePluginManifest(value: unknown): MeshyPluginManifest {
    if (!value || typeof value !== 'object') {
        throw new Error('Plugin manifest must be an object');
    }

    const manifest = value as MeshyPluginManifest;
    if (!manifest.id || !manifest.name || !manifest.version) {
        throw new Error('Plugin manifest must include id, name, and version');
    }

    const seen = new Set<string>();
    for (const preset of manifest.presets ?? []) {
        if (!preset.id || !preset.name) {
            throw new Error('Plugin preset must include id and name');
        }
        if (seen.has(preset.id)) {
            throw new Error(`Duplicate preset id: ${preset.id}`);
        }
        seen.add(preset.id);
    }

    return manifest;
}

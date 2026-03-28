import fs from 'fs';
import path from 'path';
import type { McpServerConfig } from '../../mcp/host.js';

export async function saveProjectedMcpConfig(input: {
    workspaceRoot: string;
    activeMcpServers: string[];
}): Promise<{ path: string; mcpServers: string[] }> {
    const configPath = path.join(input.workspaceRoot, '.agent', 'mcp.json');
    const configs: McpServerConfig[] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const active = new Set(input.activeMcpServers);
    const filtered = configs.filter(config => active.has(config.name));
    fs.writeFileSync(configPath, JSON.stringify(filtered, null, 2), 'utf8');
    return { path: configPath, mcpServers: filtered.map(config => config.name) };
}

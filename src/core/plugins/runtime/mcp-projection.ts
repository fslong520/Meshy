export interface McpProjectionResult {
    mcpServers: string[];
    ignored: string[];
}

export function projectActiveMcpServers(input: {
    activeCapabilities: { mcpServers: string[] };
    configuredServers: string[];
}): McpProjectionResult {
    const configured = new Set(input.configuredServers);
    const projected: string[] = [];
    const ignored: string[] = [];
    const seen = new Set<string>();

    for (const server of input.configuredServers) {
        if (input.activeCapabilities.mcpServers.includes(server) && !seen.has(server)) {
            projected.push(server);
            seen.add(server);
        }
    }

    for (const server of input.activeCapabilities.mcpServers) {
        if (!configured.has(server) && !ignored.includes(server)) {
            ignored.push(server);
        }
    }

    return { mcpServers: projected, ignored };
}

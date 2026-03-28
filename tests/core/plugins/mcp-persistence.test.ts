import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveProjectedMcpConfig } from '../../../src/core/plugins/runtime/mcp-persistence.js';

describe('saveProjectedMcpConfig', () => {
    it('rewrites .agent/mcp.json to the projected subset while preserving retained server entries', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-mcp-save-'));
        const agentDir = path.join(root, '.agent');
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'mcp.json'), JSON.stringify([
            { name: 'filesystem', command: 'fs-server', enabled: true },
            { name: 'playwright', command: 'pw-server', enabled: true },
        ], null, 2), 'utf8');

        const result = await saveProjectedMcpConfig({
            workspaceRoot: root,
            activeMcpServers: ['playwright'],
        });

        const saved = JSON.parse(fs.readFileSync(path.join(agentDir, 'mcp.json'), 'utf8'));
        expect(result.mcpServers).toEqual(['playwright']);
        expect(saved).toEqual([{ name: 'playwright', command: 'pw-server', enabled: true }]);
    });
});

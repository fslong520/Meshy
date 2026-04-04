import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { registerServerRuntimeHandlers } from '../../../src/index.js';

describe('registerServerRuntimeHandlers', () => {
    it('wires harness and plugin events to adapter-backed responses', async () => {
        const daemon = new EventEmitter() as EventEmitter & {
            sendResponse: ReturnType<typeof vi.fn>;
        };
        daemon.sendResponse = vi.fn();

        const harness = {
            createFixtureFromReplay: vi.fn().mockResolvedValue({ fixtureId: 'fx-1' }),
            runFixture: vi.fn().mockResolvedValue({ runId: 'run-1', reportId: 'rep-1', status: 'passed', scores: { goalCompletion: 1, outputMatch: 1, toolUsageMatch: 1 } }),
            getRun: vi.fn(),
            getReport: vi.fn(),
        };
        const plugins = {
            listPlugins: vi.fn().mockReturnValue([{ manifest: { id: 'demo' } }]),
            listPresets: vi.fn().mockReturnValue([{ id: 'demo/default' }]),
            enablePreset: vi.fn().mockResolvedValue({ capabilities: { mcpServers: ['filesystem'] }, mcpServers: ['filesystem'], ignoredMcpServers: [] }),
            disablePreset: vi.fn().mockResolvedValue({ capabilities: { mcpServers: [] }, mcpServers: [], ignoredMcpServers: [] }),
            getActiveCapabilities: vi.fn().mockReturnValue({ tools: ['readFile'], skills: [], agents: [], mcpServers: ['filesystem'] }),
            getActiveMcpProjection: vi.fn().mockReturnValue({ mcpServers: ['filesystem'] }),
            saveMcpProjection: vi.fn().mockResolvedValue({ path: '/tmp/.agent/mcp.json', mcpServers: ['filesystem'] }),
        };
        const tools = {
            listManifestEntries: vi.fn().mockReturnValue([
                { id: 'bash', source: 'builtin', manifest: { permissionClass: 'exec' } },
                { id: 'webfetch', source: 'catalog', manifest: { permissionClass: 'network' } },
            ]),
            summarizeManifestEntries: vi.fn().mockReturnValue({
                total: 2,
                bySource: { builtin: 1, catalog: 1 },
                byPermissionClass: { exec: 1, network: 1 },
                timeoutConfigured: 1,
                retryable: 0,
            }),
        };

        registerServerRuntimeHandlers(daemon as any, harness as any, plugins as any, tools as any);

        daemon.emit('harness:fixture:create', { replayPath: '/tmp/replay.json' }, {} as any, '1');
        await Promise.resolve();
        daemon.emit('plugin:list', {} as any, '2');
        daemon.emit('plugin:mcp:save', { workspaceRoot: '/tmp' }, {} as any, '3');
        daemon.emit('tool:manifest:list', { source: 'builtin' }, {} as any, '4');
        await Promise.resolve();

        expect(harness.createFixtureFromReplay).toHaveBeenCalledWith('/tmp/replay.json', {});
        expect(plugins.listPlugins).toHaveBeenCalled();
        expect(plugins.saveMcpProjection).toHaveBeenCalledWith('/tmp');
        expect(tools.listManifestEntries).toHaveBeenCalled();
        expect(tools.summarizeManifestEntries).toHaveBeenCalled();
        expect(daemon.sendResponse).toHaveBeenCalled();

        const toolManifestReply = daemon.sendResponse.mock.calls.find(([, msgId]) => msgId === '4')?.[2] as any;
        expect(toolManifestReply.manifests).toHaveLength(1);
        expect(toolManifestReply.manifests[0]?.id).toBe('bash');
        expect(toolManifestReply.summary.total).toBe(2);
    });
});

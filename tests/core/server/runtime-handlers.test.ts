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
            enablePreset: vi.fn(),
            disablePreset: vi.fn(),
            getActiveCapabilities: vi.fn().mockReturnValue({ tools: ['readFile'], skills: [], agents: [], mcpServers: [] }),
        };

        registerServerRuntimeHandlers(daemon as any, harness as any, plugins as any);

        daemon.emit('harness:fixture:create', { replayPath: '/tmp/replay.json' }, {} as any, '1');
        await Promise.resolve();
        daemon.emit('plugin:list', {} as any, '2');

        expect(harness.createFixtureFromReplay).toHaveBeenCalledWith('/tmp/replay.json', {});
        expect(plugins.listPlugins).toHaveBeenCalled();
        expect(daemon.sendResponse).toHaveBeenCalled();
    });
});

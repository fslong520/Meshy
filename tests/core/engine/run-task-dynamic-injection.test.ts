import { describe, expect, it, vi } from 'vitest';
import { TaskEngine } from '../../../src/core/engine/index.js';

describe('TaskEngine main path dynamic injection', () => {
    it('uses dynamic injection helper on the main runTask path', async () => {
        const engine = Object.create(TaskEngine.prototype) as TaskEngine & any;
        engine.isRunning = false;
        engine.abortController = null;
        engine.session = { history: [], activatedMcpServers: new Set(), pinnedTools: new Set(), ragSelectedTools: new Set() };
        engine.workspace = {
            rootPath: process.cwd(),
            memoryStore: { initialize: vi.fn(), getUserProfile: vi.fn().mockResolvedValue(null) },
            mcpHost: { ensureAutoStartServers: vi.fn(), getServerSummaries: vi.fn().mockReturnValue([]) },
            getRepoMap: vi.fn().mockReturnValue('repo map'),
            reflectionEngine: { recallRelevantCapsules: vi.fn() },
            snapshotManager: { appendStateUpdate: vi.fn(), clearSnapshot: vi.fn() },
        };
        engine.router = { classify: vi.fn().mockResolvedValue({ intent: 'general', systemPromptHint: '', suggestedSkills: [], confidence: 1 }) };
        engine.toolRegistry = { getCatalog: () => ({ getAdvertText: () => '' }) };
        engine.sandbox = { getMode: () => 'smart' };
        engine.ritualLoader = { buildPromptInjection: () => '' };
        engine.progressTracker = { getRecentProgress: () => '' };
        engine.healthInspector = { inspectEnvironment: vi.fn().mockResolvedValue({ isHealthy: true }) };
        engine.daemon = undefined;
        engine.customCommands = { has: () => false };
        engine.subagentRegistry = { getAgent: () => null };
        engine.addMessageAndAppend = vi.fn();
        engine.runLLMLoopWithDynamicInjection = vi.fn().mockResolvedValue(undefined);
        engine.injector = { resolve: vi.fn().mockResolvedValue({ systemPrompt: 'stale', tools: [], subagent: null }) };
        engine.runLLMLoop = vi.fn().mockResolvedValue(undefined);

        await engine._runTaskInternal('debug this issue');

        expect(engine.runLLMLoopWithDynamicInjection).toHaveBeenCalled();
    });
});

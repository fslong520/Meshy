import { describe, expect, it, vi } from 'vitest';
import { TaskEngine } from '../../../src/core/engine/index.js';

describe('TaskEngine per-loop injection', () => {
    it('recomputes injection before each loop iteration', async () => {
        const engine = Object.create(TaskEngine.prototype) as TaskEngine & any;
        engine.session = {
            history: [],
            activatedMcpServers: new Set(),
            pinnedTools: new Set(),
            ragSelectedTools: new Set(),
            runtimeDecisions: [],
            appendRuntimeDecision: vi.fn(function (record: unknown) {
                (this.runtimeDecisions as unknown[]).push(record);
            }),
        };
        engine.providerResolver = {};
        engine.workspace = { rootPath: process.cwd(), mcpHost: { getAllTools: () => [] } };
        engine.logger = { engine: vi.fn(), warn: vi.fn() };
        engine.injector = {
            resolve: vi.fn()
                .mockResolvedValueOnce({ systemPrompt: 'loop-1', tools: [], subagent: null, selectedSkills: [], reasonSummary: 'loop-1' })
                .mockResolvedValueOnce({ systemPrompt: 'loop-2', tools: [], subagent: null, selectedSkills: [], reasonSummary: 'loop-2' }),
        };
        engine.runSingleLLMIteration = vi.fn()
            .mockResolvedValueOnce({ continueLoop: true, nextUserPrompt: 'follow-up' })
            .mockResolvedValueOnce({ continueLoop: false });

        await engine.runLLMLoopWithDynamicInjection(
            { cleanText: 'first prompt', skills: [], mentions: [] } as any,
            { suggestedSkills: [] } as any,
            'base prompt',
        );

        expect(engine.injector.resolve).toHaveBeenCalledTimes(2);
    });

    it('initializes runtime decisions when session stub misses decision fields', async () => {
        const engine = Object.create(TaskEngine.prototype) as TaskEngine & any;
        engine.session = {
            history: [],
            activatedMcpServers: new Set(),
            pinnedTools: new Set(),
            ragSelectedTools: new Set(),
        };
        engine.providerResolver = {};
        engine.workspace = { rootPath: process.cwd(), mcpHost: { getAllTools: () => [] } };
        engine.logger = { engine: vi.fn(), warn: vi.fn() };
        engine.injector = {
            resolve: vi.fn().mockResolvedValueOnce({
                systemPrompt: 'loop-1',
                tools: [],
                subagent: null,
                selectedSkills: ['skill-a'],
                reasonSummary: 'first-loop',
            }),
        };
        engine.runSingleLLMIteration = vi.fn().mockResolvedValueOnce({ continueLoop: false });

        await engine.runLLMLoopWithDynamicInjection(
            { cleanText: 'first prompt', skills: [], mentions: [] } as any,
            { suggestedSkills: [] } as any,
            'base prompt',
        );

        expect(Array.isArray(engine.session.runtimeDecisions)).toBe(true);
        expect(engine.session.runtimeDecisions).toHaveLength(1);
        expect(engine.session.runtimeDecisions[0]).toMatchObject({
            loopIndex: 0,
            injectedSkills: ['skill-a'],
            reasonSummary: 'first-loop',
        });
    });
});

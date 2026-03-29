import { describe, expect, it, vi } from 'vitest';
import { TaskEngine } from '../../../src/core/engine/index.js';

describe('runtime decision trace', () => {
    it('appends one runtime decision record per loop', async () => {
        const engine = Object.create(TaskEngine.prototype) as TaskEngine & any;
        engine.session = {
            history: [],
            activatedMcpServers: new Set(['filesystem']),
            runtimeDecisions: [],
            appendRuntimeDecision: vi.fn(function (record: any) {
                this.runtimeDecisions.push(record);
            }),
        };
        engine.providerResolver = {};
        engine.workspace = { rootPath: process.cwd() };
        engine.injector = {
            resolve: vi.fn().mockResolvedValue({
                systemPrompt: 'loop',
                tools: [],
                subagent: null,
                selectedSkills: ['debug-runtime'],
                reasonSummary: 'explicit:(none); suggested:(none); retrieved:debug-runtime',
            }),
        };
        engine.runSingleLLMIteration = vi.fn().mockResolvedValue({ continueLoop: false });

        await engine.runLLMLoopWithDynamicInjection(
            { cleanText: 'debug issue', skills: [], mentions: [] } as any,
            { suggestedSkills: [] } as any,
            'base prompt',
        );

        expect(engine.session.appendRuntimeDecision).toHaveBeenCalled();
        expect(engine.session.runtimeDecisions[0]).toMatchObject({
            loopIndex: 0,
            injectedSkills: ['debug-runtime'],
            activeMcpServers: ['filesystem'],
        });
    });
});

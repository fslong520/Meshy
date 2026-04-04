import { describe, expect, it } from 'vitest';
import { RuntimeTaskManager } from '../../../src/core/runtime/tasks/task-manager.js';
import { WorkflowDefinition, WorkflowEngine } from '../../../src/core/workflow/engine.js';

describe('WorkflowEngine task-manager integration', () => {
    it('tracks step task status as completed on success', async () => {
        const taskManager = new RuntimeTaskManager();
        const engine = new WorkflowEngine(async () => 'done', taskManager);

        const workflow: WorkflowDefinition = {
            name: 'single-step',
            description: 'single step workflow',
            steps: [
                {
                    id: 'step-1',
                    name: 'Step 1',
                    promptTemplate: '{{input}}',
                    dependsOn: [],
                },
            ],
        };

        await engine.run(workflow, 'hello');

        const tracked = taskManager.getTask('step-1');
        expect(tracked?.status).toBe('completed');
        expect(engine.getTaskRecords().map((task) => task.id)).toContain('step-1');
    });

    it('tracks step task status as failed after retries are exhausted', async () => {
        const taskManager = new RuntimeTaskManager();
        const engine = new WorkflowEngine(async () => {
            throw new Error('executor boom');
        }, taskManager);

        const workflow: WorkflowDefinition = {
            name: 'failing-step',
            description: 'single failing step workflow',
            steps: [
                {
                    id: 'step-1',
                    name: 'Step 1',
                    promptTemplate: '{{input}}',
                    dependsOn: [],
                    maxRetries: 1,
                },
            ],
        };

        await engine.run(workflow, 'hello');

        const tracked = taskManager.getTask('step-1');
        expect(tracked?.status).toBe('failed');
        expect(tracked?.errorMessage).toContain('executor boom');
    });

    it('resets tracked task records between workflow runs', async () => {
        const taskManager = new RuntimeTaskManager();
        const engine = new WorkflowEngine(async () => 'ok', taskManager);

        await engine.run(
            {
                name: 'workflow-a',
                description: 'A',
                steps: [{ id: 'a', name: 'A', promptTemplate: '{{input}}', dependsOn: [] }],
            },
            'input-a',
        );

        await engine.run(
            {
                name: 'workflow-b',
                description: 'B',
                steps: [{ id: 'b', name: 'B', promptTemplate: '{{input}}', dependsOn: [] }],
            },
            'input-b',
        );

        const ids = engine.getTaskRecords().map((task) => task.id);
        expect(ids).toContain('b');
        expect(ids).not.toContain('a');
    });
});

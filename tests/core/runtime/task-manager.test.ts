import { describe, expect, it } from 'vitest';
import {
    RuntimeTaskManager,
    type RuntimeTaskRecord,
} from '../../../src/core/runtime/tasks/task-manager.js';

describe('RuntimeTaskManager', () => {
    it('creates tasks with pending status by default', () => {
        const manager = new RuntimeTaskManager();

        const task = manager.createTask({ description: 'initial task' });

        expect(task.id).toMatch(/^task-/);
        expect(task.status).toBe('pending');
        expect(task.description).toBe('initial task');
    });

    it('allows valid transitions and updates timestamps', () => {
        const manager = new RuntimeTaskManager();
        const task = manager.createTask({ description: 'transition task' });
        const initialUpdatedAt = task.updatedAt;

        const running = manager.transitionTask(task.id, 'running');
        const completed = manager.transitionTask(task.id, 'completed');

        expect(running.status).toBe('running');
        expect(completed.status).toBe('completed');
        expect(completed.updatedAt).not.toBe(initialUpdatedAt);
    });

    it('rejects non-terminal transitions from terminal states', () => {
        const manager = new RuntimeTaskManager();
        const task = manager.createTask({ description: 'terminal task' });

        manager.transitionTask(task.id, 'running');
        manager.transitionTask(task.id, 'completed');

        expect(() => manager.transitionTask(task.id, 'running')).toThrow(/Invalid transition/);
    });

    it('throws for unknown task ids', () => {
        const manager = new RuntimeTaskManager();

        expect(() => manager.transitionTask('task-missing', 'running')).toThrow(/Task not found/);
    });

    it('returns immutable task snapshots', () => {
        const manager = new RuntimeTaskManager();
        const task = manager.createTask({ description: 'immutable task' });

        const listed = manager.listTasks();
        const copy = listed[0] as RuntimeTaskRecord;
        copy.description = 'mutated';

        const original = manager.getTask(task.id);
        expect(original?.description).toBe('immutable task');
    });
});

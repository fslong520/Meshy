import { describe, expect, it } from 'vitest';
import { Session } from '../../../src/core/session/state.js';

describe('Session', () => {
    it('stores runtime task statuses on blackboard tasks', () => {
        const session = new Session('test-session');

        session.updateBlackboard({
            tasks: [
                { id: 'task-1', description: 'review approval', status: 'waiting_approval' },
                { id: 'task-2', description: 'external dependency', status: 'blocked' },
            ],
        });

        expect(session.blackboard.tasks[0]?.status).toBe('waiting_approval');
        expect(session.blackboard.tasks[1]?.status).toBe('blocked');
    });

    it('persists tool policy mode through serialization and deserialization', () => {
        const session = new Session('policy-session');
        session.toolPolicyMode = 'read_only';

        const serialized = session.serialize();
        const restored = Session.deserialize(serialized);

        expect(restored.toolPolicyMode).toBe('read_only');
    });

    it('defaults to standard tool policy mode when missing in older snapshots', () => {
        const legacyJson = JSON.stringify({
            id: 'legacy-session',
            history: [],
            blackboard: { currentGoal: '', tasks: [], openFiles: [], lastError: null },
            status: 'active',
        });

        const restored = Session.deserialize(legacyJson);
        expect(restored.toolPolicyMode).toBe('standard');
    });
});

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

    it('persists tool policy history entries through serialization', () => {
        const session = new Session('policy-history-session');
        session.toolPolicyHistory.push({
            previousMode: 'standard',
            nextMode: 'read_only',
            changedAt: '2026-01-01T00:00:00.000Z',
            source: 'runtime-api',
        });

        const serialized = session.serialize();
        const restored = Session.deserialize(serialized);

        expect(restored.toolPolicyHistory).toHaveLength(1);
        expect(restored.toolPolicyHistory[0]?.nextMode).toBe('read_only');
    });

    it('persists runtime decisions through serialization', () => {
        const session = new Session('policy-decisions-session');
        session.appendRuntimeDecision({
            loopIndex: 1,
            injectedSkills: ['debug-runtime'],
            activeMcpServers: ['filesystem'],
            reasonSummary: 'test runtime decision',
        });

        const serialized = session.serialize();
        const restored = Session.deserialize(serialized);

        expect(restored.runtimeDecisions).toHaveLength(1);
        expect(restored.runtimeDecisions[0]?.reasonSummary).toBe('test runtime decision');
    });
});

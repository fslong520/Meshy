import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Session } from '../../../src/core/session/state.js';
import { exportReplay, loadReplay } from '../../../src/core/session/replay.js';

describe('replay runtime decisions', () => {
    it('exports runtime decisions and normalizes them for legacy replay files', () => {
        const session = new Session('session-1');
        session.appendRuntimeDecision({
            loopIndex: 0,
            injectedSkills: ['debug-runtime'],
            activeMcpServers: ['filesystem'],
            reasonSummary: 'retrieved:debug-runtime',
        });

        const replay = exportReplay(session);
        expect(replay.runtimeDecisions).toHaveLength(1);
        expect(replay.runtimeDecisions[0].injectedSkills).toEqual(['debug-runtime']);

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-legacy-runtime-decisions-'));
        const filePath = path.join(dir, 'legacy.replay.json');
        fs.writeFileSync(filePath, JSON.stringify({
            sessionId: 'legacy',
            exportedAt: '2026-03-29T00:00:00.000Z',
            totalSteps: 0,
            steps: [],
            blackboard: { currentGoal: '', tasks: [] },
        }), 'utf8');

        const loaded = loadReplay(filePath);
        expect(loaded?.runtimeDecisions).toEqual([]);
    });
});

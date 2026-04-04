import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { formatReplayText, loadReplay } from '../../../src/core/session/replay.js';

describe('legacy replay compatibility', () => {
    it('loads and formats replay files without metrics', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-legacy-replay-'));
        const filePath = path.join(dir, 'legacy.replay.json');

        fs.writeFileSync(
            filePath,
            JSON.stringify({
                sessionId: 'legacy-session',
                exportedAt: '2026-03-18T00:00:00.000Z',
                totalSteps: 1,
                steps: [
                    {
                        index: 0,
                        timestamp: '2026-03-18T00:00:00.000Z',
                        role: 'user',
                        type: 'text',
                        summary: 'hello',
                        raw: 'hello',
                    },
                ],
                blackboard: {
                    currentGoal: 'legacy goal',
                    tasks: [],
                },
            }),
            'utf8',
        );

        const replay = loadReplay(filePath);

        expect(replay).not.toBeNull();
        expect(replay!.events.map((event) => event.type)).toEqual(['text']);
        expect(replay!.metrics.textMessages).toBe(0);
        expect(replay!.session.status).toBe('active');
        expect(() => formatReplayText(replay!)).not.toThrow();
    });

    it('formats legacy replay objects without metrics', () => {
        expect(() => formatReplayText({
            sessionId: 'legacy-session',
            exportedAt: '2026-03-18T00:00:00.000Z',
            totalSteps: 1,
            steps: [],
            blackboard: {
                currentGoal: 'legacy goal',
                tasks: [],
                openFiles: [],
                lastError: null,
            },
        } as never)).not.toThrow();
    });
});

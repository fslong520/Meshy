import { describe, expect, it } from 'vitest';
import { exportReplay } from '../../../src/core/session/replay.js';
import { Session } from '../../../src/core/session/state.js';

describe('replay timestamp fidelity', () => {
    it('uses message timestamps as the replay step source of truth', () => {
        const session = new Session('timestamp-source');
        session.addMessage({
            role: 'user',
            content: 'hello world',
            timestamp: '2026-04-07T00:00:00.000Z',
        });
        session.addMessage({
            role: 'assistant',
            content: {
                type: 'tool_call',
                id: 'tool-call-1',
                name: 'read_note',
                arguments: { filePath: 'note.md' },
            },
            timestamp: '2026-04-07T00:00:01.000Z',
        });

        const replay = exportReplay(session);

        expect(replay.steps[0]?.timestamp).toBe('2026-04-07T00:00:00.000Z');
        expect(replay.steps[1]?.timestamp).toBe('2026-04-07T00:00:01.000Z');
    });

    it('orders same-timestamp events by causal priority', () => {
        const session = new Session('timestamp-order');
        session.addMessage({
            role: 'assistant',
            content: {
                type: 'tool_call',
                id: 'tool-call-1',
                name: 'write_note',
                arguments: { filePath: 'a.txt' },
            },
            timestamp: '2026-04-07T00:00:00.000Z',
        });
        session.addMessage({
            role: 'user',
            content: {
                type: 'tool_result',
                id: 'tool-call-1',
                content: 'blocked by policy',
                isError: true,
                metadata: {
                    policyDecision: {
                        decision: 'deny',
                        mode: 'read_only',
                        permissionClass: 'write',
                        reason: 'blocked by policy',
                    },
                },
            },
            timestamp: '2026-04-07T00:00:00.000Z',
        });

        const replay = exportReplay(session);

        expect(replay.events.map((event) => event.type)).toEqual([
            'agent:tool_call',
            'agent:policy_decision',
            'agent:tool_result',
        ]);
    });
});

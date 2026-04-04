import { describe, expect, it } from 'vitest';
import { exportReplay } from '../../../src/core/session/replay.js';
import { Session } from '../../../src/core/session/state.js';

describe('replay unified events', () => {
    it('exports a derived replay event stream alongside steps', () => {
        const session = new Session('session-events');
        session.addMessage({ role: 'user', content: 'hello world' });
        session.addMessage({
            role: 'assistant',
            content: {
                type: 'tool_call',
                id: 'tool-call-1',
                name: 'write_note',
                arguments: { filePath: 'a.txt' },
            },
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
        });

        const replay = exportReplay(session);

        expect(replay.events.map((event) => event.type)).toEqual([
            'agent:text',
            'agent:tool_call',
            'agent:tool_result',
            'agent:policy_decision',
        ]);
        expect(replay.events[1]).toMatchObject({
            type: 'agent:tool_call',
            toolCallId: 'tool-call-1',
            toolName: 'write_note',
        });
        expect(replay.events[2]).toMatchObject({
            type: 'agent:tool_result',
            toolCallId: 'tool-call-1',
            isError: true,
        });
        expect(replay.events[3]).toMatchObject({
            type: 'agent:policy_decision',
            toolCallId: 'tool-call-1',
            toolName: 'write_note',
            decision: 'deny',
        });
    });
});

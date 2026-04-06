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

        const toolCallStep = replay.steps.find((step) => step.type === 'tool_call');
        const toolResultStep = replay.steps.find((step) => step.type === 'tool_result');

        expect(toolCallStep?.projected).toMatchObject({
            kind: 'tool_call',
            toolCallId: 'tool-call-1',
            toolName: 'write_note',
            argumentsText: '{"filePath":"a.txt"}',
        });
        expect(toolResultStep?.projected).toMatchObject({
            kind: 'tool_result',
            toolCallId: 'tool-call-1',
            content: 'blocked by policy',
            isError: true,
            policyDecision: {
                decision: 'deny',
                mode: 'read_only',
                permissionClass: 'write',
                reason: 'blocked by policy',
            },
        });
        expect(replay.events.map((event) => event.type)).toEqual([
            'agent:tool_call',
            'agent:policy_decision',
            'agent:tool_result',
            'agent:text',
        ]);
        expect(replay.events.find((event) => event.type === 'agent:tool_call')).toMatchObject({
            type: 'agent:tool_call',
            toolCallId: 'tool-call-1',
            toolName: 'write_note',
        });
        expect(replay.events.find((event) => event.type === 'agent:tool_result')).toMatchObject({
            type: 'agent:tool_result',
            toolCallId: 'tool-call-1',
            isError: true,
        });
        expect(replay.events.find((event) => event.type === 'agent:policy_decision')).toMatchObject({
            type: 'agent:policy_decision',
            toolCallId: 'tool-call-1',
            toolName: 'write_note',
            decision: 'deny',
        });
    });

    it('hydrates event derivation from projected steps when raw payload is missing', () => {
        const session = new Session('projected-steps');
        session.addMessage({ role: 'assistant', content: { type: 'tool_call', id: 'tool-call-2', name: 'read_note', arguments: { filePath: 'note.md' } } });
        session.addMessage({ role: 'user', content: { type: 'tool_result', id: 'tool-call-2', content: 'note contents', isError: false } });

        const replay = exportReplay(session);
        const toolCallStep = replay.steps.find((step) => step.type === 'tool_call');
        const toolResultStep = replay.steps.find((step) => step.type === 'tool_result');
        if (toolCallStep) toolCallStep.raw = null;
        if (toolResultStep) toolResultStep.raw = null;

        expect(replay.events.find((event) => event.type === 'agent:tool_call')).toMatchObject({
            toolCallId: 'tool-call-2',
            toolName: 'read_note',
        });
        expect(replay.events.find((event) => event.type === 'agent:tool_result')).toMatchObject({
            toolCallId: 'tool-call-2',
            content: 'note contents',
            isError: false,
        });
    });
});

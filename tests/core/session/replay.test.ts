import { describe, expect, it } from 'vitest';
import { exportReplay, formatReplayText } from '../../../src/core/session/replay.js';
import { Session } from '../../../src/core/session/state.js';

describe('formatReplayText', () => {
    it('includes replay metrics in the formatted output', () => {
        const session = new Session('session-1');
        session.title = 'Replay metrics';
        session.activeAgentId = 'agent-42';
        session.blackboard.currentGoal = 'Inspect metrics';
        session.addMessage({ role: 'user', content: 'hello world' });
        session.addMessage({
            role: 'assistant',
            content: {
                type: 'tool_call',
                id: 'tool-call-1',
                name: 'search_files',
                arguments: { query: 'replay' },
            },
        });
        session.addMessage({
            role: 'tool',
            content: {
                type: 'tool_result',
                id: 'tool-call-1',
                content: 'found one match',
            },
        });

        const replay = exportReplay(session);
        const output = formatReplayText(replay);

        expect(output).toContain('Replay Metrics');
        expect(output).toContain('Text Messages: 1');
        expect(output).toContain('Tool Calls: 1');
        expect(output).toContain('Unique Tools: search_files');
    });
});

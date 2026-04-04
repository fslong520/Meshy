import { describe, expect, it } from 'vitest';
import {
    clearPolicyDecisionTimeline,
    getPolicyDecisionTimeline,
    ingestPolicyDecisionEvent,
    type RpcMessage,
} from '../../../web/src/store/ws.js';

describe('ws policy decision timeline', () => {
    it('ingests and stores agent:policy_decision events', () => {
        clearPolicyDecisionTimeline();
        const msg: RpcMessage = {
            type: 'event',
            name: 'agent:policy_decision',
            data: {
                id: 'tool-call-1',
                tool: 'read_note',
                decision: 'allow',
                mode: 'read_only',
                permissionClass: 'read',
                reason: 'permissionClass read is allowed in read-only mode',
            },
        };

        const ingested = ingestPolicyDecisionEvent(msg);
        const timeline = getPolicyDecisionTimeline();

        expect(ingested?.tool).toBe('read_note');
        expect(timeline).toHaveLength(1);
        expect(timeline[0]?.decision).toBe('allow');
    });

    it('ignores non-policy events and invalid payloads', () => {
        clearPolicyDecisionTimeline();

        const unrelated: RpcMessage = { type: 'event', name: 'agent:text', data: { text: 'hi' } };
        const invalid: RpcMessage = { type: 'event', name: 'agent:policy_decision', data: { tool: 'bash' } };

        expect(ingestPolicyDecisionEvent(unrelated)).toBeNull();
        expect(ingestPolicyDecisionEvent(invalid)).toBeNull();
        expect(getPolicyDecisionTimeline()).toHaveLength(0);
    });
});

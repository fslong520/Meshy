import { describe, expect, it } from 'vitest';
import {
    clearPolicyDecisionTimeline,
    getPolicyDecisionTimeline,
    ingestPolicyDecisionEvent,
    replacePolicyDecisionTimeline,
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
                timestamp: '2026-04-08T00:00:07.000Z',
            },
        };

        const ingested = ingestPolicyDecisionEvent(msg);
        const timeline = getPolicyDecisionTimeline();

        expect(ingested?.tool).toBe('read_note');
        expect(timeline).toHaveLength(1);
        expect(timeline[0]?.decision).toBe('allow');
        expect(timeline[0]?.timestamp).toBe(Date.parse('2026-04-08T00:00:07.000Z'));
    });

    it('ignores non-policy events and invalid payloads', () => {
        clearPolicyDecisionTimeline();

        const unrelated: RpcMessage = { type: 'event', name: 'agent:text', data: { text: 'hi' } };
        const invalid: RpcMessage = { type: 'event', name: 'agent:policy_decision', data: { tool: 'bash' } };

        expect(ingestPolicyDecisionEvent(unrelated)).toBeNull();
        expect(ingestPolicyDecisionEvent(invalid)).toBeNull();
        expect(getPolicyDecisionTimeline()).toHaveLength(0);
    });

    it('replaces the timeline for replay hydration', () => {
        clearPolicyDecisionTimeline();

        replacePolicyDecisionTimeline([
            {
                id: 'tool-call-1',
                tool: 'write_note',
                decision: 'deny',
                mode: 'read_only',
                permissionClass: 'write',
                reason: 'blocked by policy',
                timestamp: 123,
            },
        ]);

        const timeline = getPolicyDecisionTimeline();
        expect(timeline).toHaveLength(1);
        expect(timeline[0]?.id).toBe('tool-call-1');
        expect(timeline[0]?.decision).toBe('deny');
    });

    it('stores ingested events sorted newest-first by timestamp', () => {
        clearPolicyDecisionTimeline();

        ingestPolicyDecisionEvent({
            type: 'event',
            name: 'agent:policy_decision',
            data: {
                id: 'older',
                tool: 'read_note',
                decision: 'allow',
                mode: 'read_only',
                permissionClass: 'read',
                reason: 'older event',
                timestamp: '2026-04-08T00:00:01.000Z',
            },
        });

        ingestPolicyDecisionEvent({
            type: 'event',
            name: 'agent:policy_decision',
            data: {
                id: 'newer',
                tool: 'write_note',
                decision: 'deny',
                mode: 'read_only',
                permissionClass: 'write',
                reason: 'newer event',
                timestamp: '2026-04-08T00:00:03.000Z',
            },
        });

        const timeline = getPolicyDecisionTimeline();
        expect(timeline.map((event) => event.id)).toEqual(['newer', 'older']);
    });

    it('keeps the newest 200 events by timestamp when replacing the timeline', () => {
        clearPolicyDecisionTimeline();

        replacePolicyDecisionTimeline(
            Array.from({ length: 205 }, (_, index) => ({
                id: `event-${index}`,
                tool: `tool-${index}`,
                decision: index % 2 === 0 ? 'allow' : 'deny',
                mode: 'read_only',
                permissionClass: index % 2 === 0 ? 'read' : 'write',
                reason: `reason-${index}`,
                timestamp: index,
            })),
        );

        const timeline = getPolicyDecisionTimeline();
        expect(timeline).toHaveLength(200);
        expect(timeline[0]?.id).toBe('event-204');
        expect(timeline[199]?.id).toBe('event-5');
    });

    it('deduplicates ingested events by id keeping the newest timestamp', () => {
        clearPolicyDecisionTimeline();

        ingestPolicyDecisionEvent({
            type: 'event',
            name: 'agent:policy_decision',
            data: {
                id: 'tool-call-1',
                tool: 'write_note',
                decision: 'allow',
                mode: 'read_only',
                permissionClass: 'read',
                reason: 'older version',
                timestamp: '2026-04-08T00:00:01.000Z',
            },
        });

        ingestPolicyDecisionEvent({
            type: 'event',
            name: 'agent:policy_decision',
            data: {
                id: 'tool-call-1',
                tool: 'write_note',
                decision: 'deny',
                mode: 'read_only',
                permissionClass: 'write',
                reason: 'newer version',
                timestamp: '2026-04-08T00:00:03.000Z',
            },
        });

        const timeline = getPolicyDecisionTimeline();
        expect(timeline).toHaveLength(1);
        expect(timeline[0]).toMatchObject({
            id: 'tool-call-1',
            decision: 'deny',
            reason: 'newer version',
            timestamp: Date.parse('2026-04-08T00:00:03.000Z'),
        });
    });

    it('deduplicates replacement timeline by id keeping the newest timestamp', () => {
        clearPolicyDecisionTimeline();

        replacePolicyDecisionTimeline([
            {
                id: 'tool-call-1',
                tool: 'write_note',
                decision: 'allow',
                mode: 'read_only',
                permissionClass: 'read',
                reason: 'older version',
                timestamp: 1,
            },
            {
                id: 'tool-call-1',
                tool: 'write_note',
                decision: 'deny',
                mode: 'read_only',
                permissionClass: 'write',
                reason: 'newer version',
                timestamp: 3,
            },
            {
                id: 'tool-call-2',
                tool: 'read_note',
                decision: 'allow',
                mode: 'read_only',
                permissionClass: 'read',
                reason: 'another event',
                timestamp: 2,
            },
        ]);

        const timeline = getPolicyDecisionTimeline();
        expect(timeline).toHaveLength(2);
        expect(timeline.map((event) => event.id)).toEqual(['tool-call-1', 'tool-call-2']);
        expect(timeline[0]?.reason).toBe('newer version');
    });
});

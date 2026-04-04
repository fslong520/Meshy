import { describe, expect, it, vi } from 'vitest';
import { TaskEngine } from '../../../src/core/engine/index.js';

describe('TaskEngine tool result daemon payload', () => {
    it('broadcasts policyDecision metadata on agent:tool_result events', async () => {
        const engine = Object.create(TaskEngine.prototype) as TaskEngine & any;
        engine.session = { id: 'session-1' };
        engine.workspace = {
            mcpHost: { callTool: vi.fn() },
        };
        engine.sandbox = {
            requestApproval: vi.fn().mockResolvedValue({ approved: true, autoApproved: false }),
        };
        engine.daemon = {
            broadcast: vi.fn(),
        };
        engine.toolRegistry = {
            execute: vi.fn().mockResolvedValue({
                output: 'ok',
                isError: false,
                metadata: {
                    policyDecision: {
                        decision: 'allow',
                        mode: 'read_only',
                        permissionClass: 'read',
                        reason: 'permissionClass read is allowed in read-only mode',
                    },
                },
            }),
        };

        await engine.executeTool('tool-call-1', 'read_note', {}, undefined);

        expect(engine.daemon.broadcast).toHaveBeenCalledWith('agent:tool_result', expect.objectContaining({
            id: 'tool-call-1',
            tool: 'read_note',
            policyDecision: expect.objectContaining({
                decision: 'allow',
                mode: 'read_only',
                permissionClass: 'read',
            }),
        }));
    });
});

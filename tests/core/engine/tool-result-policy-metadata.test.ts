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

        expect(engine.daemon.broadcast).toHaveBeenCalledWith('agent:policy_decision', expect.objectContaining({
            id: 'tool-call-1',
            tool: 'read_note',
            decision: 'allow',
            mode: 'read_only',
            permissionClass: 'read',
        }));
    });

    it('broadcasts agent:error with policyDecision when registry returns denied result', async () => {
        const engine = Object.create(TaskEngine.prototype) as TaskEngine & any;
        engine.session = { id: 'session-2' };
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
                output: 'blocked by policy',
                isError: true,
                metadata: {
                    policyDecision: {
                        decision: 'deny',
                        mode: 'read_only',
                        permissionClass: 'write',
                        reason: 'permissionClass write is blocked in read-only mode',
                    },
                },
            }),
        };

        await engine.executeTool('tool-call-2', 'write_note', {}, undefined);

        expect(engine.daemon.broadcast).toHaveBeenCalledWith('agent:error', expect.objectContaining({
            id: 'tool-call-2',
            tool: 'write_note',
            reason: 'blocked by policy',
            policyDecision: expect.objectContaining({
                decision: 'deny',
                mode: 'read_only',
                permissionClass: 'write',
            }),
        }));
    });

    it('broadcasts sandbox deny as agent:error with policyDecision payload', async () => {
        const engine = Object.create(TaskEngine.prototype) as TaskEngine & any;
        engine.session = { id: 'session-3' };
        engine.workspace = {
            mcpHost: { callTool: vi.fn() },
        };
        engine.sandbox = {
            requestApproval: vi.fn().mockResolvedValue({ approved: false, reason: 'User denied' }),
        };
        engine.daemon = {
            broadcast: vi.fn(),
        };
        engine.toolRegistry = {
            getPolicyMode: vi.fn().mockReturnValue('read_only'),
            execute: vi.fn(),
        };

        await expect(engine.executeTool('tool-call-3', 'runCommand', { command: 'rm -rf /' }, undefined)).rejects.toThrow();

        expect(engine.daemon.broadcast).toHaveBeenCalledWith('agent:error', expect.objectContaining({
            id: 'tool-call-3',
            tool: 'runCommand',
            reason: 'User denied',
            policyDecision: expect.objectContaining({
                decision: 'deny',
                mode: 'read_only',
                reason: 'sandbox denied action',
            }),
        }));
    });
});

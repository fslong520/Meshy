/**
 * Session Replay — 结构化决策链路导出与回放
 *
 * 职责：
 * 1. 将 Session 历史导出为结构化的 Replay 格式（JSON）
 * 2. 每个步骤包含时间戳、角色、内容摘要、工具调用细节
 * 3. 支持过滤和检索，便于调试和审计
 *
 * 参考 OpenClaw 的 Session Replay 调试工具。
 */

import fs from 'fs';
import path from 'path';
import { RuntimeDecisionRecord, Session } from './state.js';
import { StandardMessage, StandardToolCall, StandardToolResult } from '../llm/provider.js';
import { getLogger } from '../logger/index.js';
import type { ReplayEvent, ReplayExport, ReplayMetrics, ReplayStep } from '../../shared/replay-contract.js';
import { normalizeReplayExport } from '../../shared/replay-export-normalization.js';

export type { ReplayEvent, ReplayExport, ReplayMetrics, ReplayStep } from '../../shared/replay-contract.js';

/**
 * 将 Session 导出为结构化的 Replay 格式
 */
export function exportReplay(session: Session): ReplayExport {
    const steps: ReplayStep[] = session.history.map((msg, idx) => {
        return messageToStep(msg, idx);
    });
    const metrics = computeReplayMetrics(session, steps);
    const toolNamesById = new Map<string, string>();
    for (const msg of session.history) {
        if (isStandardToolCallContent(msg.content)) {
            toolNamesById.set(msg.content.id, msg.content.name);
        }
    }
    const policyDecisions = steps.flatMap((step) => {
        if (step.type !== 'tool_result') {
            return [];
        }

        const raw = step.raw as {
            id?: string;
            metadata?: {
                policyDecision?: {
                    decision?: 'allow' | 'deny';
                    mode?: string;
                    permissionClass?: string;
                    reason?: string;
                };
            };
        };
        const policyDecision = raw.metadata?.policyDecision;
        if (!raw.id || !policyDecision?.decision || !policyDecision.mode || !policyDecision.permissionClass || !policyDecision.reason) {
            return [];
        }

        return [{
            id: raw.id,
            tool: toolNamesById.get(raw.id) ?? 'unknown_tool',
            decision: policyDecision.decision,
            mode: policyDecision.mode,
            permissionClass: policyDecision.permissionClass,
            reason: policyDecision.reason,
            timestamp: step.timestamp,
        }];
    });
    const events = deriveReplayEvents(steps, policyDecisions);

    return {
        sessionId: session.id,
        exportedAt: new Date().toISOString(),
        totalSteps: steps.length,
        steps,
        events,
        runtimeDecisions: session.runtimeDecisions,
        policyDecisions,
        metrics,
        blackboard: {
            currentGoal: session.blackboard.currentGoal,
            tasks: session.blackboard.tasks.map(t => ({
                id: t.id,
                description: t.description,
                status: t.status,
            })),
            openFiles: session.blackboard.openFiles,
            lastError: session.blackboard.lastError,
        },
        session: {
            title: session.title,
            status: session.status,
            activeAgentId: session.activeAgentId,
            messageCount: session.history.length,
        },
    };
}

function computeReplayMetrics(session: Session, steps: ReplayStep[]): ReplayMetrics {
    const metrics: ReplayMetrics = {
        messageCountByRole: {
            system: 0,
            user: 0,
            assistant: 0,
            tool: 0,
        },
        textMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalTextCharacters: 0,
        uniqueTools: [],
    };
    const uniqueTools = new Set<string>();

    for (const [index, step] of steps.entries()) {
        metrics.messageCountByRole[step.role]++;

        if (step.type === 'text') {
            metrics.textMessages++;
            if (typeof session.history[index]?.content === 'string') {
                metrics.totalTextCharacters += session.history[index].content.length;
            } else {
                metrics.totalTextCharacters += step.summary.length;
            }
        } else if (step.type === 'tool_call') {
            metrics.toolCalls++;
            const content = session.history[index]?.content;
            if (isStandardToolCallContent(content)) {
                uniqueTools.add(content.name);
            }
        } else if (step.type === 'tool_result') {
            metrics.toolResults++;
        }
    }

    metrics.uniqueTools = Array.from(uniqueTools).sort();
    return metrics;
}

function isStandardToolCallContent(content: StandardMessage['content'] | undefined): content is StandardToolCall {
    return !!content
        && typeof content !== 'string'
        && !Array.isArray(content)
        && content.type === 'tool_call'
        && typeof content.name === 'string';
}

/** 将单条消息转为 ReplayStep */
function messageToStep(msg: StandardMessage, index: number): ReplayStep {
    const timestamp = new Date().toISOString(); // 理想情况下消息自带时间戳

    if (typeof msg.content === 'string') {
        const truncated = msg.content.length > 200
            ? msg.content.slice(0, 200) + '...'
            : msg.content;
        return {
            index,
            timestamp,
            role: msg.role,
            type: 'text',
            summary: truncated,
            raw: msg.content,
        };
    }

    const content = msg.content as unknown as (StandardToolCall | StandardToolResult);

    if (content.type === 'tool_call') {
        const tc = content as StandardToolCall;
        return {
            index,
            timestamp,
            role: msg.role,
            type: 'tool_call',
            summary: `Tool: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`,
            raw: tc,
        };
    }

    if (content.type === 'tool_result') {
        const tr = content as StandardToolResult;
        const truncated = tr.content.length > 150
            ? tr.content.slice(0, 150) + '...'
            : tr.content;
        return {
            index,
            timestamp,
            role: msg.role,
            type: 'tool_result',
            summary: `Result: ${truncated}`,
            raw: tr,
        };
    }

    // Fallback
    return {
        index,
        timestamp,
        role: msg.role,
        type: 'text',
        summary: JSON.stringify(msg.content).slice(0, 200),
        raw: msg.content,
    };
}

/**
 * 将 Replay 导出保存到 .meshy/replays/ 目录
 */
export function saveReplay(
    replay: ReplayExport,
    workspaceRoot: string,
): string {
    const logger = getLogger();
    const replayDir = path.join(workspaceRoot, '.meshy', 'replays');
    fs.mkdirSync(replayDir, { recursive: true });

    const filename = `${replay.sessionId}.replay.json`;
    const filePath = path.join(replayDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(replay, null, 2), 'utf8');
    logger.session(`Replay exported: ${filePath} (${replay.totalSteps} steps)`);

    return filePath;
}

/**
 * 从文件加载 Replay
 */
export function loadReplay(filePath: string): ReplayExport | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return normalizeReplayExport(JSON.parse(raw), { deriveEvents: deriveReplayEvents });
    } catch {
        return null;
    }
}

function deriveReplayEvents(
    steps: ReplayStep[],
    policyDecisions: ReplayExport['policyDecisions'],
): ReplayEvent[] {
    const toolNamesById = new Map<string, string>();
    const events: ReplayEvent[] = [];

    for (const step of steps) {
        if (step.type === 'text') {
            if (step.role === 'tool') {
                continue;
            }
            events.push({
                type: 'agent:text',
                timestamp: step.timestamp,
                role: step.role,
                content: typeof step.raw === 'string' ? step.raw : step.summary,
            });
            continue;
        }

        if (step.type === 'tool_call') {
            const raw = step.raw as StandardToolCall;
            const toolName = raw.name ?? step.summary.replace(/^Tool:\s*/, '').replace(/\(.*$/, '');
            const toolCallId = raw.id ?? `tool-call-${step.index}`;
            toolNamesById.set(toolCallId, toolName);
            events.push({
                type: 'agent:tool_call',
                timestamp: step.timestamp,
                toolCallId,
                toolName,
                argumentsText: raw.arguments ? JSON.stringify(raw.arguments) : '',
            });
            continue;
        }

        if (step.type === 'tool_result') {
            const raw = step.raw as StandardToolResult;
            const toolCallId = raw.id ?? `tool-call-${step.index}`;
            events.push({
                type: 'agent:tool_result',
                timestamp: step.timestamp,
                toolCallId,
                toolName: toolNamesById.get(toolCallId) ?? 'unknown_tool',
                content: raw.content ?? step.summary.replace(/^Result:\s*/, ''),
                isError: Boolean(raw.isError),
            });
        }
    }

    for (const decision of policyDecisions) {
        events.push({
            type: 'agent:policy_decision',
            timestamp: decision.timestamp,
            toolCallId: decision.id,
            toolName: decision.tool,
            decision: decision.decision,
            mode: decision.mode,
            permissionClass: decision.permissionClass,
            reason: decision.reason,
        });
    }

    return events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

/**
 * 格式化 Replay 为可读的文本输出（用于 CLI 展示）
 */
export function formatReplayText(replay: ReplayExport): string {
    const normalized = normalizeReplayExport(replay, { deriveEvents: deriveReplayEvents });
    const lines: string[] = [
        `Session Replay: ${normalized.sessionId}`,
        `Exported: ${normalized.exportedAt}`,
        `Total Steps: ${normalized.totalSteps}`,
        `Session Status: ${normalized.session.status}`,
        `Active Agent: ${normalized.session.activeAgentId}`,
        `Goal: ${normalized.blackboard.currentGoal || '(none)'}`,
        '',
        'Replay Metrics:',
        `  Text Messages: ${normalized.metrics.textMessages}`,
        `  Tool Calls: ${normalized.metrics.toolCalls}`,
        `  Tool Results: ${normalized.metrics.toolResults}`,
        `  Unique Tools: ${normalized.metrics.uniqueTools.length > 0 ? normalized.metrics.uniqueTools.join(', ') : '(none)'}`,
        '',
        '─'.repeat(60),
    ];

    for (const step of normalized.steps) {
        const roleTag = step.role.toUpperCase().padEnd(10);
        const typeTag = step.type.padEnd(12);
        lines.push(`[${String(step.index).padStart(3)}] ${roleTag} ${typeTag} ${step.summary}`);
    }

    if (normalized.blackboard.tasks.length > 0) {
        lines.push('', '─'.repeat(60), 'Tasks:');
        for (const t of normalized.blackboard.tasks) {
            lines.push(`  [${t.status}] ${t.id}: ${t.description}`);
        }
    }

    return lines.join('\n');
}

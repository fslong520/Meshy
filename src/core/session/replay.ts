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

// ─── Replay Step 定义 ───
export interface ReplayStep {
    index: number;
    timestamp: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    type: 'text' | 'tool_call' | 'tool_result';
    /** 消息文本或工具调用摘要 */
    summary: string;
    /** 完整原始内容 */
    raw: unknown;
}

// ─── Replay 完整导出 ───
export interface ReplayMetrics {
    messageCountByRole: {
        system: number;
        user: number;
        assistant: number;
        tool: number;
    };
    textMessages: number;
    toolCalls: number;
    toolResults: number;
    totalTextCharacters: number;
    uniqueTools: string[];
}

export interface ReplayExport {
    sessionId: string;
    exportedAt: string;
    totalSteps: number;
    steps: ReplayStep[];
    runtimeDecisions: RuntimeDecisionRecord[];
    metrics: ReplayMetrics;
    blackboard: {
        currentGoal: string;
        tasks: Array<{ id: string; description: string; status: string }>;
        openFiles: string[];
        lastError: string | null;
    };
    session: {
        title?: string;
        status: string;
        activeAgentId: string;
        messageCount: number;
    };
}

/**
 * 将 Session 导出为结构化的 Replay 格式
 */
export function exportReplay(session: Session): ReplayExport {
    const steps: ReplayStep[] = session.history.map((msg, idx) => {
        return messageToStep(msg, idx);
    });
    const metrics = computeReplayMetrics(session, steps);

    return {
        sessionId: session.id,
        exportedAt: new Date().toISOString(),
        totalSteps: steps.length,
        steps,
        runtimeDecisions: session.runtimeDecisions,
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
            if (typeof content !== 'string' && content && content.type === 'tool_call' && content.name) {
                uniqueTools.add(content.name);
            }
        } else if (step.type === 'tool_result') {
            metrics.toolResults++;
        }
    }

    metrics.uniqueTools = Array.from(uniqueTools).sort();
    return metrics;
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
        return normalizeReplay(JSON.parse(raw));
    } catch {
        return null;
    }
}

function normalizeReplay(value: any): ReplayExport {
    const steps = Array.isArray(value.steps) ? value.steps : [];

    return {
        sessionId: value.sessionId,
        exportedAt: value.exportedAt,
        totalSteps: value.totalSteps ?? steps.length,
        steps,
        runtimeDecisions: Array.isArray(value.runtimeDecisions) ? value.runtimeDecisions : [],
        metrics: value.metrics ?? {
            messageCountByRole: { system: 0, user: 0, assistant: 0, tool: 0 },
            textMessages: 0,
            toolCalls: 0,
            toolResults: 0,
            totalTextCharacters: 0,
            uniqueTools: [],
        },
        blackboard: {
            currentGoal: value.blackboard?.currentGoal ?? '',
            tasks: Array.isArray(value.blackboard?.tasks) ? value.blackboard.tasks : [],
            openFiles: Array.isArray(value.blackboard?.openFiles) ? value.blackboard.openFiles : [],
            lastError: value.blackboard?.lastError ?? null,
        },
        session: {
            title: value.session?.title,
            status: value.session?.status ?? 'active',
            activeAgentId: value.session?.activeAgentId ?? 'default',
            messageCount: value.session?.messageCount ?? steps.length,
        },
    };
}

/**
 * 格式化 Replay 为可读的文本输出（用于 CLI 展示）
 */
export function formatReplayText(replay: ReplayExport): string {
    const normalized = normalizeReplay(replay);
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

    for (const step of replay.steps) {
        const roleTag = step.role.toUpperCase().padEnd(10);
        const typeTag = step.type.padEnd(12);
        lines.push(`[${String(step.index).padStart(3)}] ${roleTag} ${typeTag} ${step.summary}`);
    }

    if (replay.blackboard.tasks.length > 0) {
        lines.push('', '─'.repeat(60), 'Tasks:');
        for (const t of replay.blackboard.tasks) {
            lines.push(`  [${t.status}] ${t.id}: ${t.description}`);
        }
    }

    return lines.join('\n');
}

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
import { Session } from './state.js';
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
export interface ReplayExport {
    sessionId: string;
    exportedAt: string;
    totalSteps: number;
    steps: ReplayStep[];
    blackboard: {
        currentGoal: string;
        tasks: Array<{ id: string; description: string; status: string }>;
    };
}

/**
 * 将 Session 导出为结构化的 Replay 格式
 */
export function exportReplay(session: Session): ReplayExport {
    const steps: ReplayStep[] = session.history.map((msg, idx) => {
        return messageToStep(msg, idx);
    });

    return {
        sessionId: session.id,
        exportedAt: new Date().toISOString(),
        totalSteps: steps.length,
        steps,
        blackboard: {
            currentGoal: session.blackboard.currentGoal,
            tasks: session.blackboard.tasks.map(t => ({
                id: t.id,
                description: t.description,
                status: t.status,
            })),
        },
    };
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
        return JSON.parse(raw) as ReplayExport;
    } catch {
        return null;
    }
}

/**
 * 格式化 Replay 为可读的文本输出（用于 CLI 展示）
 */
export function formatReplayText(replay: ReplayExport): string {
    const lines: string[] = [
        `Session Replay: ${replay.sessionId}`,
        `Exported: ${replay.exportedAt}`,
        `Total Steps: ${replay.totalSteps}`,
        `Goal: ${replay.blackboard.currentGoal || '(none)'}`,
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

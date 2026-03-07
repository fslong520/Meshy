/**
 * ProgressTracker — 跨窗口进度文件
 *
 * 灵感来源：
 *  - Anthropic claude-progress.txt: "让每个新 session 的 Agent 通过读取进度文件快速了解项目状态"
 *  - OpenAI Harness Engineering: "context 是稀缺资源，给 Agent 一张地图"
 *
 * 职责：
 *  1. 在每次 compaction 后，将压缩摘要追加到 .agent/progress.md
 *  2. 在 session 开始时，提供进度文件内容作为 system prompt 补充
 *  3. 管理进度文件大小，防止无限增长
 */

import fs from 'fs';
import path from 'path';
import { getLogger } from '../logger/index.js';

// ─── 配置常量 ───
const PROGRESS_FILE_NAME = 'progress.md';
const MAX_PROGRESS_ENTRIES = 20;    // 最多保留的进度条目数
const MAX_CONTEXT_CHARS = 2000;     // 注入 system prompt 时的最大字符数

export class ProgressTracker {
    private filePath: string;

    constructor(workspaceRoot: string) {
        const agentDir = path.join(workspaceRoot, '.agent');
        if (!fs.existsSync(agentDir)) {
            fs.mkdirSync(agentDir, { recursive: true });
        }
        this.filePath = path.join(agentDir, PROGRESS_FILE_NAME);
    }

    /**
     * 追加一条进度记录。
     * 通常在 CompactionAgent.compact() 完成后调用。
     */
    appendEntry(entry: ProgressEntry): void {
        const logger = getLogger();

        const header = fs.existsSync(this.filePath)
            ? ''
            : '# Agent Progress Log\n\nThis file tracks work progress across sessions. It is auto-updated by the compaction system.\n\n---\n\n';

        const block = [
            `## ${entry.timestamp}`,
            `**Session**: ${entry.sessionId}`,
            '',
            entry.summary,
            '',
            '---',
            '',
        ].join('\n');

        fs.appendFileSync(this.filePath, header + block, 'utf-8');

        logger.engine(`Progress entry appended to ${PROGRESS_FILE_NAME}`);

        // Trim if too many entries
        this.trimEntries();
    }

    /**
     * 获取最近的进度摘要，用于注入 system prompt。
     * 返回 null 如果没有进度文件。
     */
    getRecentProgress(): string | null {
        if (!fs.existsSync(this.filePath)) return null;

        try {
            const content = fs.readFileSync(this.filePath, 'utf-8');
            if (!content.trim()) return null;

            // 如果文件太长，只取最后 MAX_CONTEXT_CHARS 个字符
            if (content.length > MAX_CONTEXT_CHARS) {
                const truncated = content.slice(-MAX_CONTEXT_CHARS);
                // 从下一个 "## " 标题开始截取，保持结构完整
                const headerIdx = truncated.indexOf('\n## ');
                if (headerIdx >= 0) {
                    return '...[earlier progress omitted]\n' + truncated.slice(headerIdx);
                }
                return '...[earlier progress omitted]\n' + truncated;
            }

            return content;
        } catch {
            return null;
        }
    }

    /**
     * 清除过旧的进度条目，保留最近 MAX_PROGRESS_ENTRIES 条。
     */
    private trimEntries(): void {
        if (!fs.existsSync(this.filePath)) return;

        const content = fs.readFileSync(this.filePath, 'utf-8');
        // 按 "## " 分割为条目
        const parts = content.split(/(?=^## )/m);

        // 第一个 part 通常是 header
        if (parts.length <= MAX_PROGRESS_ENTRIES + 1) return;

        const header = parts[0];
        const entries = parts.slice(1);
        const kept = entries.slice(-MAX_PROGRESS_ENTRIES);

        fs.writeFileSync(this.filePath, header + kept.join(''), 'utf-8');

        const logger = getLogger();
        logger.engine(`Trimmed progress file: removed ${entries.length - kept.length} old entries`);
    }
}

export interface ProgressEntry {
    sessionId: string;
    timestamp: string;
    summary: string;
}

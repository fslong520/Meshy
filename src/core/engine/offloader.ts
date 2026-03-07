/**
 * ToolOutputOffloader — 工具输出卸载器
 *
 * 当工具返回的结果过长时，自动将完整输出写入临时文件，
 * 在 session history 中只保留摘要 + 文件路径指针。
 *
 * 灵感来源：
 * - Cursor "history-as-files" (Dynamic Context Discovery)
 * - Anthropic "structured artifacts" (Harness Engineering)
 *
 * 策略：
 *  1. 检测 tool result 的字符长度
 *  2. 超过 OFFLOAD_THRESHOLD 的输出 → 写入 .agent/tmp/tool_outputs/
 *  3. 在 history 中替换为：前 N 字符摘要 + 文件路径
 *  4. 白名单工具（如 askUser）永远不 offload
 */

import fs from 'fs';
import path from 'path';
import { getLogger } from '../logger/index.js';

// ─── 配置常量 ───
const OFFLOAD_THRESHOLD = 2000;       // 超过此字符数触发 offload
const PREVIEW_LENGTH = 300;           // offload 后保留的预览字符数
const TAIL_LENGTH = 100;              // offload 后保留的尾部字符数

/** 永远不会被 offload 的工具列表 */
const NEVER_OFFLOAD_TOOLS = new Set([
    'askUser',
    'ask_user',
    'notify_user',
]);

export interface OffloadResult {
    /** 处理后的内容（可能是原文或摘要+路径） */
    content: string;
    /** 是否触发了 offload */
    offloaded: boolean;
    /** offload 后的文件路径（如果触发了 offload） */
    filePath?: string;
}

export class ToolOutputOffloader {
    private outputDir: string;

    constructor(workspaceRoot: string) {
        this.outputDir = path.join(workspaceRoot, '.agent', 'tmp', 'tool_outputs');
    }

    /**
     * 处理工具输出。如果输出过长，则写入文件并返回摘要。
     * 否则原样返回。
     */
    process(toolName: string, toolCallId: string, rawOutput: string): OffloadResult {
        // Guard: 白名单工具不 offload
        if (NEVER_OFFLOAD_TOOLS.has(toolName)) {
            return { content: rawOutput, offloaded: false };
        }

        // Guard: 短输出不 offload
        if (rawOutput.length <= OFFLOAD_THRESHOLD) {
            return { content: rawOutput, offloaded: false };
        }

        // Offload: 写入文件
        const logger = getLogger();
        const filePath = this.writeToFile(toolName, toolCallId, rawOutput);

        // 构建预览摘要
        const preview = rawOutput.slice(0, PREVIEW_LENGTH);
        const tail = rawOutput.slice(-TAIL_LENGTH);
        const savedChars = rawOutput.length - PREVIEW_LENGTH - TAIL_LENGTH;

        const summary = [
            preview,
            '',
            `... [${savedChars} characters offloaded to file] ...`,
            '',
            tail,
            '',
            `📁 Full output saved to: ${filePath}`,
            `💡 Use readFile tool to view the complete output if needed.`,
        ].join('\n');

        logger.engine(
            `Offloaded tool output: ${toolName} (${rawOutput.length} chars → ${summary.length} chars, saved ${savedChars} chars)`
        );

        return { content: summary, offloaded: true, filePath };
    }

    /**
     * 将工具输出写入文件。
     * 文件名格式：{timestamp}_{toolName}.txt
     */
    private writeToFile(toolName: string, toolCallId: string, content: string): string {
        // 确保目录存在
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }

        // 清理工具名中的非法文件名字符
        const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const timestamp = Date.now();
        const shortId = toolCallId.slice(-6);
        const fileName = `${timestamp}_${safeName}_${shortId}.txt`;
        const filePath = path.join(this.outputDir, fileName);

        fs.writeFileSync(filePath, content, 'utf-8');

        return filePath;
    }

    /**
     * 清理过期的 offload 文件（超过 24 小时）。
     * 可在 session 启动时调用。
     */
    cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
        if (!fs.existsSync(this.outputDir)) return 0;

        const logger = getLogger();
        const now = Date.now();
        let cleaned = 0;

        const files = fs.readdirSync(this.outputDir);
        for (const file of files) {
            const filePath = path.join(this.outputDir, file);
            try {
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(filePath);
                    cleaned++;
                }
            } catch {
                // Skip files that can't be stat'd or deleted
            }
        }

        if (cleaned > 0) {
            logger.engine(`Cleaned up ${cleaned} expired tool output files`);
        }

        return cleaned;
    }
}

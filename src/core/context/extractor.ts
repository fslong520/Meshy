/**
 * Context Extractor — 上下文抽取引擎
 *
 * 为前端 UI 的 Cmd+L / Cmd+K / Cmd+E 等交互提供后端数据支持。
 * 将用户从编辑器、终端中选取 / 拖拽的内容转化为结构化的 Context Pill，
 * 安全地注入到 LLM 请求的 System 区域，精确指引 Agent 修改位置。
 *
 * Context Pill 类型：
 * - code_selection: 编辑器代码高亮选区
 * - terminal_output: 终端崩溃 / 构建日志
 * - file_reference: 拖拽的文件引用
 * - memory_capsule: 来自 MemoryStore 的知识胶囊
 */

// ─── Context Pill 基础类型 ───
export type PillType = 'code_selection' | 'terminal_output' | 'file_reference' | 'memory_capsule';

export interface ContextPill {
    type: PillType;
    /** 前端展示：简短标签，如 `src/main.rs:45-60` */
    label: string;
    /** 完整数据负载 */
    payload: CodeSelectionPayload | TerminalOutputPayload | FileReferencePayload | MemoryCapsulePayload;
}

export interface CodeSelectionPayload {
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    symbol?: string;       // 可选：选中的符号名
    language?: string;     // 可选：语言标识
}

export interface TerminalOutputPayload {
    content: string;
    command?: string;      // 产生输出的命令
    exitCode?: number;
    shell?: string;        // e.g. bash, powershell
    os?: string;           // e.g. Windows 11, macOS 15
}

export interface FileReferencePayload {
    filePath: string;
    mimeType?: string;
    sizeBytes?: number;
}

export interface MemoryCapsulePayload {
    capsuleId: number;
    summary: string;
    category: string;
}

/**
 * 从编辑器选区创建 Code Selection Pill。
 */
export function createCodePill(
    filePath: string,
    startLine: number,
    endLine: number,
    content: string,
    symbol?: string,
    language?: string,
): ContextPill {
    return {
        type: 'code_selection',
        label: `${filePath}:${startLine}-${endLine}`,
        payload: { filePath, startLine, endLine, content, symbol, language } satisfies CodeSelectionPayload,
    };
}

/**
 * 从终端输出创建 Terminal Output Pill。
 */
export function createTerminalPill(
    content: string,
    command?: string,
    exitCode?: number,
): ContextPill {
    return {
        type: 'terminal_output',
        label: command ? `Terminal: ${command.slice(0, 40)}` : 'Terminal Output',
        payload: {
            content,
            command,
            exitCode,
            shell: process.platform === 'win32' ? 'powershell' : 'bash',
            os: `${process.platform} ${process.arch}`,
        } satisfies TerminalOutputPayload,
    };
}

/**
 * 从文件拖拽创建 File Reference Pill。
 */
export function createFilePill(filePath: string, mimeType?: string, sizeBytes?: number): ContextPill {
    return {
        type: 'file_reference',
        label: filePath,
        payload: { filePath, mimeType, sizeBytes } satisfies FileReferencePayload,
    };
}

/**
 * 从记忆胶囊创建 Memory Capsule Pill。
 */
export function createMemoryPill(capsuleId: number, summary: string, category: string): ContextPill {
    return {
        type: 'memory_capsule',
        label: `Memory #${capsuleId}`,
        payload: { capsuleId, summary, category } satisfies MemoryCapsulePayload,
    };
}

/**
 * 将一组 Context Pills 序列化为 XML 标签格式的 System Context 片段。
 * 这段文本会被拼入 LLM 请求的 System Prompt 中，精确指引 Agent 操作位置。
 */
export function serializePillsToPrompt(pills: ContextPill[]): string {
    if (pills.length === 0) return '';

    const blocks = pills.map((pill) => {
        switch (pill.type) {
            case 'code_selection': {
                const p = pill.payload as CodeSelectionPayload;
                return [
                    `<context type="code_selection" file="${p.filePath}" lines="${p.startLine}-${p.endLine}"${p.symbol ? ` symbol="${p.symbol}"` : ''}>`,
                    p.content,
                    '</context>',
                ].join('\n');
            }

            case 'terminal_output': {
                const p = pill.payload as TerminalOutputPayload;
                return [
                    `<context type="terminal_output"${p.command ? ` command="${p.command}"` : ''}${p.exitCode !== undefined ? ` exitCode="${p.exitCode}"` : ''} shell="${p.shell}" os="${p.os}">`,
                    p.content,
                    '</context>',
                ].join('\n');
            }

            case 'file_reference': {
                const p = pill.payload as FileReferencePayload;
                return `<context type="file_reference" file="${p.filePath}"${p.mimeType ? ` mime="${p.mimeType}"` : ''} />`;
            }

            case 'memory_capsule': {
                const p = pill.payload as MemoryCapsulePayload;
                return `<context type="memory" capsuleId="${p.capsuleId}" category="${p.category}">${p.summary}</context>`;
            }

            default:
                return '';
        }
    });

    return blocks.filter(Boolean).join('\n\n');
}

/**
 * Inline Edit Session — 极速原地编辑请求
 *
 * 对应 Cmd+K 悬浮框：不在主 Chat 留痕，开启一个短生命周期的独立 Session，
 * 由轻量级 LLM 快速生成 Diff。
 */
export interface InlineEditRequest {
    filePath: string;
    startLine: number;
    endLine: number;
    selectedContent: string;
    userInstruction: string;
}

export interface InlineEditResult {
    originalContent: string;
    modifiedContent: string;
    diff: string;
}

/**
 * 生成 Inline Edit 的 Diff 预览。
 * 计算 原文 vs 修改后的 逐行差异，供前端渲染 Green/Red Diff View。
 */
export function generateSimpleDiff(original: string, modified: string): string {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    const result: string[] = [];

    const maxLen = Math.max(origLines.length, modLines.length);

    for (let i = 0; i < maxLen; i++) {
        const origLine = i < origLines.length ? origLines[i] : undefined;
        const modLine = i < modLines.length ? modLines[i] : undefined;

        if (origLine === modLine) {
            result.push(`  ${origLine}`);
        } else {
            if (origLine !== undefined) {
                result.push(`- ${origLine}`);
            }
            if (modLine !== undefined) {
                result.push(`+ ${modLine}`);
            }
        }
    }

    return result.join('\n');
}

/**
 * InputParser — 用户输入语法解析器
 *
 * 解析用户原始输入中的特殊控制语法：
 * - `/` (Slash Commands): 改变执行模式或触发内建指令
 * - `@` (Mentions): 注入显式上下文（文件、工具、Agent）
 * - `#` (Symbol Refs): 引用代码符号或 Issue 编号
 *
 * 参考 OpenCode 的输入解析机制设计。
 */

// ─── Slash Command 定义 ───

export type SlashCommandType =
    | 'ask'        // 仅问答，禁止编辑
    | 'plan'       // 规划模式，仅输出任务拆解
    | 'clear'      // 清空当前 Session
    | 'summarize'  // 压缩上下文
    | 'undo'       // 回滚上一次编辑
    | 'test'       // 直接跑测试
    | 'compact'    // 压缩对话历史
    | 'model'      // 查看/切换模型
    | 'help';      // 显示帮助

export interface SlashCommand {
    type: SlashCommandType;
    /** 斜杠命令后面跟随的原始参数 */
    args: string;
}

// ─── @ Mention 定义 ───

export type MentionNamespace =
    | 'file'       // @file:path/to/file.ts
    | 'mcp'        // @mcp:browsermcp
    | 'agent'      // @agent:FrontendExpert
    | 'skill'      // @skill:web-search
    | 'terminal'   // @terminal:recent
    | 'raw';       // @something（无命名空间，兼容旧格式）

export interface MentionRef {
    namespace: MentionNamespace;
    value: string;
    /** 原始匹配文本（含 @） */
    raw: string;
}

// ─── # Symbol Reference 定义 ───

export type SymbolRefType =
    | 'symbol'     // #functionName → 代码符号
    | 'issue'      // #123 → Issue/PR 编号
    | 'terminal';  // #terminal / #errors → 终端输出引用

export interface SymbolRef {
    type: SymbolRefType;
    value: string;
    raw: string;
}

// ─── 解析结果 ───

export interface ParsedInput {
    /** 清洗完所有标记后的纯用户文本 */
    cleanText: string;
    /** 检测到的 slash 指令（仅当输入以 / 开头时） */
    slashCommand: SlashCommand | null;
    /** 检测到的 @ 引用列表 */
    mentions: MentionRef[];
    /** 检测到的 # 符号引用列表 */
    symbolRefs: SymbolRef[];
}

// ─── 常量 ───

const VALID_SLASH_COMMANDS = new Set<SlashCommandType>([
    'ask', 'plan', 'clear', 'summarize', 'undo', 'test', 'compact', 'model', 'help',
]);

/**
 * @ Mention 正则：
 * 匹配 `@namespace:value` 或 `@value`（必须前面是空格或行首）
 */
const MENTION_REGEX = /(?:^|\s)@((?:file|mcp|agent|skill|terminal):)?(\S+)/g;

/**
 * # Symbol Ref 正则：
 * 匹配 `#word` 或 `#123`（必须前面是空格或行首）
 */
const SYMBOL_REF_REGEX = /(?:^|\s)#(\S+)/g;

// ─── 解析逻辑 ───

/** 解析 slash command（仅当输入第一个字符为 /） */
function parseSlashCommand(input: string): SlashCommand | null {
    if (!input.startsWith('/')) return null;

    const spaceIdx = input.indexOf(' ');
    const commandStr = spaceIdx > 0
        ? input.slice(1, spaceIdx).toLowerCase()
        : input.slice(1).toLowerCase();

    if (!VALID_SLASH_COMMANDS.has(commandStr as SlashCommandType)) {
        return null;
    }

    const args = spaceIdx > 0 ? input.slice(spaceIdx + 1).trim() : '';

    return {
        type: commandStr as SlashCommandType,
        args,
    };
}

/** 解析所有 @ mentions */
function parseMentions(input: string): MentionRef[] {
    const results: MentionRef[] = [];

    for (const match of input.matchAll(MENTION_REGEX)) {
        const nsPrefix = match[1]; // 如 "file:" 或 undefined
        const value = match[2];
        const raw = match[0].trim();

        let namespace: MentionNamespace;
        if (nsPrefix) {
            namespace = nsPrefix.slice(0, -1) as MentionNamespace; // 去掉尾部冒号
        } else {
            namespace = 'raw';
        }

        results.push({ namespace, value, raw });
    }

    return results;
}

/** 解析所有 # symbol references */
function parseSymbolRefs(input: string): SymbolRef[] {
    const results: SymbolRef[] = [];

    for (const match of input.matchAll(SYMBOL_REF_REGEX)) {
        const value = match[1];
        const raw = match[0].trim();

        let type: SymbolRefType;
        if (value === 'terminal' || value === 'errors') {
            type = 'terminal';
        } else if (/^\d+$/.test(value)) {
            type = 'issue';
        } else {
            type = 'symbol';
        }

        results.push({ type, value, raw });
    }

    return results;
}

/** 从输入中移除所有已识别的标记，返回纯净文本 */
function cleanInput(input: string, mentions: MentionRef[], symbolRefs: SymbolRef[]): string {
    let cleaned = input;

    // 移除 @ 标记
    for (const m of mentions) {
        cleaned = cleaned.replace(m.raw, '');
    }

    // 移除 # 标记
    for (const s of symbolRefs) {
        cleaned = cleaned.replace(s.raw, '');
    }

    // 合并多余空格
    return cleaned.replace(/\s+/g, ' ').trim();
}

// ─── 公开 API ───

export class InputParser {
    /**
     * 解析用户原始输入，提取控制语法并返回结构化结果。
     */
    static parse(rawInput: string): ParsedInput {
        const trimmed = rawInput.trim();

        // 1. Slash command（优先级最高，整条输入视为命令）
        const slashCommand = parseSlashCommand(trimmed);
        if (slashCommand) {
            return {
                cleanText: slashCommand.args,
                slashCommand,
                mentions: [],
                symbolRefs: [],
            };
        }

        // 2. @ Mentions
        const mentions = parseMentions(trimmed);

        // 3. # Symbol Refs
        const symbolRefs = parseSymbolRefs(trimmed);

        // 4. 清洗后的纯文本
        const cleanText = cleanInput(trimmed, mentions, symbolRefs);

        return {
            cleanText,
            slashCommand: null,
            mentions,
            symbolRefs,
        };
    }
}

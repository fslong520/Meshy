/**
 * Subagent Loader — 子智能体配置加载器
 *
 * 职责：
 * 1. 扫描 `.agent/subagents/` 目录下的 Markdown 配置文件
 * 2. 解析 YAML-like Frontmatter（简易 key: value 行解析，不依赖 yaml 库）
 * 3. 解析 Markdown Body 作为 Subagent 的 System Prompt（灵魂/Persona）
 * 4. 提供按名称精确唤醒和按关键词模糊检索能力
 *
 * 参考 OpenCode 的 agent 定义方式：Frontmatter 配置 + Body 即 Prompt。
 */

import fs from 'fs';
import path from 'path';

// ─── Subagent 配置 ───
export interface SubagentConfig {
    /** 唯一标识名（即文件名去掉 .md） */
    name: string;
    /** 绑定的模型名 */
    model: string;
    /** 允许使用的工具白名单（为空表示全量暴露） */
    allowedTools: string[];
    /** 描述信息 */
    description: string;
    /** System Prompt（直接来自 Markdown Body） */
    systemPrompt: string;
    /** 原始配置文件路径 */
    filePath: string;
    /** 自动触发关键词（供 Router 被动路由） */
    triggerKeywords: string[];
    /** 传给 Subagent 的历史消息上限（默认 6） */
    maxContextMessages: number;
    /** 返回格式约束 */
    reportFormat: 'text' | 'json';
}

// ─── Frontmatter 解析（简易 key: value，参考 OpenCode 实现） ───
const YAML_FENCE_REGEX = /^---\s*\n([\s\S]*?)\n---/;
const JSON_BLOCK_REGEX = /^```json\s*\n([\s\S]*?)\n```/;

/**
 * 简易 Frontmatter 解析器。
 * 逐行解析 `key: value` 格式，支持 JSON 内联值（数组/对象）。
 * 不引入第三方 YAML 库，保持零依赖。
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
    // 优先匹配 --- 围栏
    const yamlMatch = content.match(YAML_FENCE_REGEX);
    if (yamlMatch) {
        const meta = parseKeyValueBlock(yamlMatch[1]);
        const body = content.slice(yamlMatch[0].length).trim();
        return { meta, body };
    }

    // 后备：JSON 代码块
    const jsonMatch = content.match(JSON_BLOCK_REGEX);
    if (jsonMatch) {
        try {
            const meta = JSON.parse(jsonMatch[1]);
            const body = content.slice(jsonMatch[0].length).trim();
            return { meta, body };
        } catch { /* fallthrough */ }
    }

    return { meta: {}, body: content };
}

/**
 * 逐行解析 key: value 块。
 * 值支持：字符串、数字、布尔、JSON 数组/对象。
 */
function parseKeyValueBlock(block: string): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0) continue;

        const key = trimmed.slice(0, colonIdx).trim();
        const rawVal = trimmed.slice(colonIdx + 1).trim();

        meta[key] = parseSimpleValue(rawVal);
    }

    return meta;
}

/** 将原始字符串值转为合适的 JS 类型 */
function parseSimpleValue(raw: string): unknown {
    if (raw.length === 0) return '';

    // JSON 内联值（数组或对象）
    if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
        try { return JSON.parse(raw); } catch { /* fallthrough */ }
    }

    // 布尔
    if (raw === 'true') return true;
    if (raw === 'false') return false;

    // 数字
    const asNum = Number(raw);
    if (!isNaN(asNum) && raw.length > 0) return asNum;

    // 去除可能的引号包裹
    return raw.replace(/^["']|["']$/g, '');
}

/** 安全提取字符串数组 */
function toStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    return [];
}

/**
 * SubagentRegistry — 子智能体注册表
 */
export class SubagentRegistry {
    private agents: Map<string, SubagentConfig> = new Map();
    private agentsDir: string;

    constructor(workspaceRoot: string = process.cwd()) {
        this.agentsDir = path.join(workspaceRoot, '.meshy', 'agents');
    }

    /**
     * 扫描 .meshy/agents/ 目录，自动发现并注册所有子智能体配置。
     */
    public scan(): void {
        if (!fs.existsSync(this.agentsDir)) return;

        const files = fs.readdirSync(this.agentsDir).filter(f => f.endsWith('.md'));

        for (const file of files) {
            const filePath = path.join(this.agentsDir, file);
            const raw = fs.readFileSync(filePath, 'utf8');
            const { meta, body } = parseFrontmatter(raw);

            const name = file.replace(/\.md$/, '');

            const config: SubagentConfig = {
                name,
                model: typeof meta.model === 'string' ? meta.model : 'gpt-4o-mini',
                allowedTools: toStringArray(meta['allowed-tools']),
                description: typeof meta.description === 'string' ? meta.description : '',
                systemPrompt: body,
                filePath,
                triggerKeywords: toStringArray(meta['trigger-keywords']),
                maxContextMessages: typeof meta['max-context-messages'] === 'number'
                    ? meta['max-context-messages']
                    : 6,
                reportFormat: meta['report-format'] === 'json' ? 'json' : 'text',
            };

            this.agents.set(name, config);
        }
    }

    public getAgent(name: string): SubagentConfig | undefined {
        return this.agents.get(name);
    }

    public listAgents(): SubagentConfig[] {
        return Array.from(this.agents.values());
    }

    /**
     * 根据用户输入的关键词，匹配可能相关的 Subagent（被动路由）。
     */
    public matchByKeywords(userInput: string): SubagentConfig[] {
        const lower = userInput.toLowerCase();
        return this.listAgents().filter(agent =>
            agent.triggerKeywords.some(kw => lower.includes(kw.toLowerCase()))
        );
    }

    /**
     * 解析 `@agent_name` 或 `@agent:agent_name` 前缀。
     */
    public resolveAtMention(input: string): { agent: SubagentConfig | null; cleanInput: string } {
        const nsMatch = input.match(/^@agent:(\S+)\s*/);
        if (nsMatch) {
            const agent = this.agents.get(nsMatch[1]) ?? null;
            return { agent, cleanInput: input.slice(nsMatch[0].length).trim() };
        }

        const atMatch = input.match(/^@(\S+)\s*/);
        if (!atMatch) {
            return { agent: null, cleanInput: input };
        }

        const agent = this.agents.get(atMatch[1]) ?? null;
        return { agent, cleanInput: input.slice(atMatch[0].length).trim() };
    }
}

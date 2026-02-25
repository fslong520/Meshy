/**
 * Subagent Loader — 子智能体配置加载器
 *
 * 职责：
 * 1. 扫描 `.agent/subagents/` 目录下的 Markdown 配置文件
 * 2. 解析 YAML Frontmatter 作为 Subagent 的工程配置（模型、工具白名单等）
 * 3. 解析 Markdown Body 作为 Subagent 的 System Prompt（灵魂/Persona）
 * 4. 提供按名称精确唤醒和按关键词模糊检索能力
 */

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

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

// ─── Frontmatter 解析 ───
const YAML_FENCE_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * 从 Markdown 中提取 YAML Frontmatter（使用 `yaml` 库进行可靠解析）。
 * 同时支持 JSON 代码块格式（```json ... ```）作为后备。
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
    // 优先尝试标准 YAML Frontmatter (--- ... ---)
    const yamlMatch = content.match(YAML_FENCE_REGEX);
    if (yamlMatch) {
        try {
            const meta = YAML.parse(yamlMatch[1]) as Record<string, unknown>;
            const body = content.slice(yamlMatch[0].length).trim();
            return { meta: meta ?? {}, body };
        } catch (err) {
            console.warn(`[SubagentLoader] YAML parse error, falling back to raw body:`, err);
        }
    }

    // 后备：JSON 代码块
    const jsonMatch = content.match(/^```json\s*\n([\s\S]*?)\n```/);
    if (jsonMatch) {
        try {
            const meta = JSON.parse(jsonMatch[1]);
            const body = content.slice(jsonMatch[0].length).trim();
            return { meta, body };
        } catch { /* fallthrough */ }
    }

    return { meta: {}, body: content };
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
        this.agentsDir = path.join(workspaceRoot, '.agent', 'subagents');
    }

    /**
     * 扫描 .agent/subagents/ 目录，自动发现并注册所有子智能体配置。
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
        // 支持 @agent:name 命名空间格式
        const nsMatch = input.match(/^@agent:(\S+)\s*/);
        if (nsMatch) {
            const agent = this.agents.get(nsMatch[1]) ?? null;
            return { agent, cleanInput: input.slice(nsMatch[0].length).trim() };
        }

        // 兼容旧的 @name 格式
        const atMatch = input.match(/^@(\S+)\s*/);
        if (!atMatch) {
            return { agent: null, cleanInput: input };
        }

        const agent = this.agents.get(atMatch[1]) ?? null;
        return { agent, cleanInput: input.slice(atMatch[0].length).trim() };
    }
}

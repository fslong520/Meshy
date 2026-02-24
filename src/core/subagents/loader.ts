/**
 * Subagent Loader — 子智能体配置加载器
 *
 * 职责：
 * 1. 扫描 `.agent/subagents/` 目录下的 Markdown 配置文件
 * 2. 解析 Frontmatter 作为 Subagent 的工程配置（模型、工具白名单等）
 * 3. 解析 Markdown Body 作为 Subagent 的 System Prompt（灵魂/Persona）
 * 4. 提供按名称精确唤醒和按关键词模糊检索能力
 */

import fs from 'fs';
import path from 'path';

// ─── Subagent 配置 ───
export interface SubagentConfig {
    /** 唯一标识名（即文件名去掉 .md） */
    name: string;
    /** 绑定的模型名 */
    model: string;
    /** 允许使用的工具白名单 */
    allowedTools: string[];
    /** 描述信息 */
    description: string;
    /** System Prompt（直接来自 Markdown Body） */
    systemPrompt: string;
    /** 原始配置文件路径 */
    filePath: string;
}

// 简易 Frontmatter 解析（复用 JSON 块和 --- 块两种格式）
const JSON_BLOCK_REGEX = /^```json\s*\n([\s\S]*?)\n```/;
const YAML_FENCE_REGEX = /^---\s*\n([\s\S]*?)\n---/;

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
    const jsonMatch = content.match(JSON_BLOCK_REGEX);
    if (jsonMatch) {
        try {
            const meta = JSON.parse(jsonMatch[1]);
            const body = content.slice(jsonMatch[0].length).trim();
            return { meta, body };
        } catch { /* fallthrough */ }
    }

    const yamlMatch = content.match(YAML_FENCE_REGEX);
    if (yamlMatch) {
        const meta: Record<string, unknown> = {};
        for (const line of yamlMatch[1].split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const key = line.slice(0, colonIdx).trim();
                const val = line.slice(colonIdx + 1).trim();
                try { meta[key] = JSON.parse(val); } catch { meta[key] = val; }
            }
        }
        const body = content.slice(yamlMatch[0].length).trim();
        return { meta, body };
    }

    return { meta: {}, body: content };
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
                model: (meta.model as string) || 'gpt-4o-mini',
                allowedTools: (meta['allowed-tools'] as string[]) || [],
                description: (meta.description as string) || '',
                systemPrompt: body,
                filePath,
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
     * 解析 `@agent_name` 前缀，如果输入以 @ 开头则返回匹配到的 Subagent 和剩余输入。
     */
    public resolveAtMention(input: string): { agent: SubagentConfig | null; cleanInput: string } {
        const atMatch = input.match(/^@(\S+)\s*/);
        if (!atMatch) {
            return { agent: null, cleanInput: input };
        }

        const agentName = atMatch[1];
        const agent = this.agents.get(agentName) ?? null;
        const cleanInput = input.slice(atMatch[0].length).trim();

        return { agent, cleanInput };
    }
}

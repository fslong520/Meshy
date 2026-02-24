/**
 * Skill Parser — Markdown 驱动的技能树解析器
 *
 * 职责：
 * 1. 扫描 `.agent/skills/` 目录下的所有 SKILL.md 文件
 * 2. 解析 YAML-like Frontmatter 提取结构化元数据（名称、描述、工具 Schema）
 * 3. 在内存中构建轻量级 Raw 索引，供 Router 和惰性注入器快速检索
 * 4. 按需读取完整的 Markdown Body 作为 Agent 的 System Prompt 片段
 */

import fs from 'fs';
import path from 'path';

// ─── 技能元数据 ───
export interface SkillMeta {
    name: string;
    description: string;
    keywords: string[];
    tools?: SkillToolSchema[];
    /** SKILL.md 文件完整路径 */
    filePath: string;
}

export interface SkillToolSchema {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

// ─── Frontmatter 分隔符: 用 JSON 块 ───
const JSON_BLOCK_REGEX = /^```json\s*\n([\s\S]*?)\n```/;
const YAML_FENCE_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * 从 Markdown 文件中解析 Frontmatter（支持 JSON 代码块 和 --- YAML 风格）。
 * 返回 { meta, body }，meta 为解析后的对象，body 为剩余正文。
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
    // 优先尝试 JSON 代码块
    const jsonMatch = content.match(JSON_BLOCK_REGEX);
    if (jsonMatch) {
        try {
            const meta = JSON.parse(jsonMatch[1]);
            const body = content.slice(jsonMatch[0].length).trim();
            return { meta, body };
        } catch {
            // fallthrough
        }
    }

    // 其次尝试 --- 分隔的简易 key: value
    const yamlMatch = content.match(YAML_FENCE_REGEX);
    if (yamlMatch) {
        const meta: Record<string, unknown> = {};
        for (const line of yamlMatch[1].split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const key = line.slice(0, colonIdx).trim();
                const val = line.slice(colonIdx + 1).trim();
                // 尝试解析数组（简易 JSON 值）
                try {
                    meta[key] = JSON.parse(val);
                } catch {
                    meta[key] = val;
                }
            }
        }
        const body = content.slice(yamlMatch[0].length).trim();
        return { meta, body };
    }

    // 无 Frontmatter
    return { meta: {}, body: content };
}

/**
 * SkillRegistry — 技能注册表
 *
 * 在启动时扫描 `.agent/skills/` 目录树，解析所有 SKILL.md，
 * 在内存中维护一份轻量级索引。
 */
export class SkillRegistry {
    private skills: Map<string, SkillMeta> = new Map();
    private bodyCache: Map<string, string> = new Map();
    private skillsDir: string;

    constructor(workspaceRoot: string = process.cwd()) {
        this.skillsDir = path.join(workspaceRoot, '.agent', 'skills');
    }

    /**
     * 扫描 .agent/skills/ 目录，自动发现并注册所有技能。
     */
    public scan(): void {
        if (!fs.existsSync(this.skillsDir)) {
            return; // 目录不存在则静默跳过
        }

        const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillFile = path.join(this.skillsDir, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillFile)) continue;

            const raw = fs.readFileSync(skillFile, 'utf8');
            const { meta, body } = parseFrontmatter(raw);

            const skillMeta: SkillMeta = {
                name: (meta.name as string) || entry.name,
                description: (meta.description as string) || '',
                keywords: (meta.keywords as string[]) || [],
                tools: (meta.tools as SkillToolSchema[]) || undefined,
                filePath: skillFile,
            };

            this.skills.set(skillMeta.name, skillMeta);
            this.bodyCache.set(skillMeta.name, body);
        }
    }

    /**
     * 返回所有已注册技能的元数据列表（轻量级，不含 Body）。
     */
    public listSkills(): SkillMeta[] {
        return Array.from(this.skills.values());
    }

    /**
     * 根据名称精确获取某个技能的元数据。
     */
    public getSkill(name: string): SkillMeta | undefined {
        return this.skills.get(name);
    }

    /**
     * 延迟加载某个技能的完整 Markdown Body（用于 System Prompt 注入）。
     */
    public getSkillBody(name: string): string | undefined {
        return this.bodyCache.get(name);
    }

    /**
     * 基于关键词在已注册技能中进行快速检索。
     * 匹配规则：技能的 name / description / keywords 与查询词的交集。
     */
    public searchByKeywords(query: string): SkillMeta[] {
        const lowerQuery = query.toLowerCase();
        const tokens = lowerQuery.split(/\s+/);

        const scored: Array<{ skill: SkillMeta; score: number }> = [];

        for (const skill of this.skills.values()) {
            let score = 0;
            const haystack = [
                skill.name,
                skill.description,
                ...skill.keywords,
            ].join(' ').toLowerCase();

            for (const token of tokens) {
                if (haystack.includes(token)) {
                    score++;
                }
            }

            if (score > 0) {
                scored.push({ skill, score });
            }
        }

        return scored
            .sort((a, b) => b.score - a.score)
            .map(s => s.skill);
    }
}

/**
 * Skill Parser — Markdown 驱动的技能树解析器
 *
 * 职责：
 * 1. 扫描全局 (`~/.meshy/skills/`) 和项目 (`.agent/skills/`) 目录下的所有 SKILL.md
 * 2. 解析 YAML-like Frontmatter 提取结构化元数据（名称、描述、工具 Schema）
 * 3. 在内存中构建轻量级 Raw 索引，供 Router 和惰性注入器快速检索
 * 4. 按需读取完整的 Markdown Body 作为 Agent 的 System Prompt 片段
 * 5. 支持 refreshAll() 全量重扫并返回可序列化列表供 DB 持久化
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── 技能元数据 ───
export interface SkillMeta {
    name: string;
    description: string;
    keywords: string[];
    tools?: SkillToolSchema[];
    /** SKILL.md 文件完整路径 */
    filePath: string;
    /** 技能来源：global = ~/.meshy/skills/, project = .agent/skills/ */
    source: 'global' | 'project';
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
 * 在启动时扫描全局 + 项目 `.agent/skills/` 目录树，解析所有 SKILL.md，
 * 在内存中维护一份轻量级索引。项目技能优先级高于全局技能（同名覆盖）。
 */
export class SkillRegistry {
    private skills: Map<string, SkillMeta> = new Map();
    private bodyCache: Map<string, string> = new Map();
    private globalSkillsDir: string;

    constructor() {
        this.globalSkillsDir = path.join(os.homedir(), '.meshy', 'skills');
    }

    /**
     * 扫描全局 + 项目目录，自动发现并注册所有技能。
     * 项目技能优先级高于全局技能（同名时覆盖）。
     */
    public scan(workspaceRoot?: string): void {
        this.scanDirectory(this.globalSkillsDir, 'global');
        if (workspaceRoot) {
            const projectDir = path.join(workspaceRoot, '.agent', 'skills');
            this.scanDirectory(projectDir, 'project');
        }
    }

    /**
     * 清空缓存并重新扫描所有目录，返回最新的完整列表。
     */
    public refreshAll(workspaceRoot?: string): SkillMeta[] {
        this.skills.clear();
        this.bodyCache.clear();
        this.scan(workspaceRoot);
        return this.listSkills();
    }

    /**
     * 扫描指定目录下的所有 SKILL.md 文件。
     */
    private scanDirectory(dir: string, source: 'global' | 'project'): void {
        console.log(`[SkillRegistry] Scanning ${source} skills in: ${dir}`);
        if (!fs.existsSync(dir)) {
            console.log(`[SkillRegistry] Directory does not exist: ${dir}`);
            return;
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        console.log(`[SkillRegistry] Found ${entries.length} entries in ${dir}`);

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillFile = path.join(dir, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillFile)) continue;

            try {
                const raw = fs.readFileSync(skillFile, 'utf8');
                const { meta, body } = parseFrontmatter(raw);

                const skillMeta: SkillMeta = {
                    name: (meta.name as string) || entry.name,
                    description: (meta.description as string) || '',
                    keywords: (meta.keywords as string[]) || [],
                    tools: (meta.tools as SkillToolSchema[]) || undefined,
                    filePath: skillFile,
                    source,
                };

                this.skills.set(skillMeta.name, skillMeta);
                this.bodyCache.set(skillMeta.name, body);
            } catch (err) {
                console.warn(`[SkillRegistry] Failed to parse ${skillFile}:`, err);
            }
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

/**
 * SystemPromptBuilder — 结构化 System Prompt 组装器
 *
 * 职责：
 * 1. 接收来自 RoutingDecision、Skill Body、ToolCatalog advert、Memory Hint 等多来源片段
 * 2. 按优先级有序拼接成最终的 System Prompt
 * 3. 提供链式 API 供 Subagent / Manager 场景灵活使用
 * 4. 自动截断过长的个别片段，防止无限膨胀
 */

/** 单个 Prompt 片段的最大字符数（超出则截断并附省略提示） */
const MAX_SECTION_LENGTH = 3000;

/** 截断辅助函数 */
function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '\n... [truncated]';
}

export class SystemPromptBuilder {
    private basePrompt: string;
    private persona: string | null = null;
    private routingHint: string | null = null;
    private skillSections: string[] = [];
    private catalogAdvert: string | null = null;
    private memoryHint: string | null = null;
    private repoMap: string | null = null;
    private contextBlocks: string[] = [];
    private constraints: string[] = [];
    private ritualContext: string | null = null;
    private userProfile: string | null = null;
    private environmentContext: string | null = null;

    constructor(basePrompt: string) {
        this.basePrompt = basePrompt;
    }

    /** 设置 Subagent 专属 Persona（替换默认 basePrompt） */
    withPersona(persona: string): this {
        this.persona = persona;
        return this;
    }

    /** 来自 IntentRouter 的 systemPromptHint */
    withRoutingHint(hint: string): this {
        this.routingHint = hint;
        return this;
    }

    /** 注入技能 Body 片段（可多次调用） */
    withSkillSection(skillName: string, body: string): this {
        this.skillSections.push(
            `\n--- Skill: ${skillName} ---\n${truncate(body, MAX_SECTION_LENGTH)}`
        );
        return this;
    }

    /** ToolCatalog 广告文本 */
    withCatalogAdvert(advert: string): this {
        this.catalogAdvert = advert;
        return this;
    }

    /** Phase 4 经验回放提示 */
    withMemoryHint(hint: string): this {
        this.memoryHint = hint;
        return this;
    }

    /** 注入整个项目的代码大纲地图 */
    withRepoMap(map: string): this {
        this.repoMap = map;
        return this;
    }

    /** 通过 @file: 或 @terminal: 引入的上下文块 */
    withContextBlock(label: string, content: string): this {
        this.contextBlocks.push(
            `<context source="${label}">\n${truncate(content, MAX_SECTION_LENGTH)}\n</context>`
        );
        return this;
    }

    /** 模式约束（如 /ask → readOnly, /plan → planOnly） */
    withConstraint(constraint: string): this {
        this.constraints.push(constraint);
        return this;
    }

    /** Phase 16: Ritual 上下文注入（SOUL.md / BOOTSTRAP.md） */
    withRitualContext(ritualContext: string): this {
        this.ritualContext = ritualContext;
        return this;
    }

    /** Phase 19: 注入经过提炼的 User Profile (长记忆) */
    withUserProfile(profile: string): this {
        this.userProfile = profile;
        return this;
    }

    /** 注入系统环境信息 (Phase 27, enhanced) */
    withEnvironmentContext(osPlatform: string, workspaceRoot: string): this {
        const today = new Date().toDateString();
        this.environmentContext = [
            `\n<env>`,
            `  Working directory: ${workspaceRoot}`,
            `  Platform: ${osPlatform}`,
            `  Today's date: ${today}`,
            `</env>`,
            `Read files and execute local commands cautiously; do not guess syntax or assume file existence.`,
        ].join('\n');
        return this;
    }

    /** 组装最终的 System Prompt 字符串 */
    build(): string {
        const parts: string[] = [];

        // --- STATIC PREFIX (Highly Cacheable) ---

        // 1. 核心身份（Persona 优先于 basePrompt）
        parts.push(this.persona ?? this.basePrompt);

        // 1.5 Ritual 上下文（人格指令）
        if (this.ritualContext) {
            parts.push(this.ritualContext);
        }

        // 1.8 User Profile (长记忆潜意识)
        if (this.userProfile) {
            parts.push(`\n[System Constraints & User Profile]\nThe following rules are extracted from your long-term memory about the user and their preferences:\n${this.userProfile}\n`);
        }

        // 1.9 Environment Context
        if (this.environmentContext) {
            parts.push(this.environmentContext);
        }

        // 2. RepoMap
        if (this.repoMap) {
            parts.push(`\n<repository_map>\n${this.repoMap}\n</repository_map>\n`);
        }

        // 3. ToolCatalog 广告
        if (this.catalogAdvert) {
            parts.push(this.catalogAdvert);
        }

        // 4. 技能段
        for (const section of this.skillSections) {
            parts.push(section);
        }

        // 5. 经验回放
        if (this.memoryHint) {
            parts.push(this.memoryHint);
        }

        // --- DYNAMIC SUFFIX (Session/Turn Specific) ---

        // 6. 路由提示
        if (this.routingHint) {
            parts.push(this.routingHint);
        }

        // 7. 模式约束
        if (this.constraints.length > 0) {
            parts.push(
                `**Constraints for this session:**\n${this.constraints.map(c => `- ${c}`).join('\n')}`
            );
        }

        // 8. 上下文块
        if (this.contextBlocks.length > 0) {
            parts.push(this.contextBlocks.join('\n'));
        }

        return parts.filter(Boolean).join('\n\n');
    }
}

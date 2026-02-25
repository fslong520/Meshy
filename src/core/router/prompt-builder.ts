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
    private contextBlocks: string[] = [];
    private constraints: string[] = [];

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

    /** 组装最终的 System Prompt 字符串 */
    build(): string {
        const parts: string[] = [];

        // 1. 核心身份（Persona 优先于 basePrompt）
        parts.push(this.persona ?? this.basePrompt);

        // 2. 路由提示
        if (this.routingHint) {
            parts.push(this.routingHint);
        }

        // 3. 模式约束
        if (this.constraints.length > 0) {
            parts.push(
                `**Constraints for this session:**\n${this.constraints.map(c => `- ${c}`).join('\n')}`
            );
        }

        // 4. 经验回放
        if (this.memoryHint) {
            parts.push(this.memoryHint);
        }

        // 5. ToolCatalog 广告
        if (this.catalogAdvert) {
            parts.push(this.catalogAdvert);
        }

        // 6. 技能段
        for (const section of this.skillSections) {
            parts.push(section);
        }

        // 7. 上下文块
        if (this.contextBlocks.length > 0) {
            parts.push(this.contextBlocks.join('\n'));
        }

        return parts.filter(Boolean).join('\n\n');
    }
}

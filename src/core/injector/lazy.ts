/**
 * Lazy Injector — 惰性工具注入器
 *
 * 职责：
 * 1. 接收 IntentRouter 的 RoutingDecision
 * 2. 根据决策中的 suggestedSkills 和用户输入，从 SkillRegistry 中检索命中的技能
 * 3. 将命中技能的 Tool Schema 动态注入到发往 LLM 的请求 Payload 中
 * 4. 将技能的 Markdown Body 片段拼接到 System Prompt 中
 * 5. 处理 @subagent 唤醒，用 Subagent 的 Prompt 替换默认 System Prompt
 *
 * 核心理念：工具即知识 (Tool as Knowledge)
 * 默认只保留 ACI 基础工具常驻上下文，其余技能按需延迟加载。
 */

import { StandardTool } from '../llm/provider.js';
import { SkillRegistry } from '../skills/registry.js';
import { SubagentRegistry, SubagentConfig } from '../subagents/loader.js';
import { RoutingDecision } from '../router/intent.js';
import { Session } from '../session/state.js';
import { ToolRegistry } from '../tool/registry.js';
import { ToolPackRegistry } from '../tool/tool-pack.js';

/** ToolRAG Top-K 默认值 */
const DEFAULT_RAG_TOP_K = 8;

export interface InjectionResult {
    /** 组装后的完整 System Prompt */
    systemPrompt: string;
    /** 需要注入到请求 payload 中的工具列表 */
    tools: StandardTool[];
    /** 如果命中了 Subagent，则返回其配置 */
    subagent: SubagentConfig | null;
}

export class LazyInjector {
    private skillRegistry: SkillRegistry;
    private subagentRegistry: SubagentRegistry;
    private toolRegistry: ToolRegistry;
    private toolPackRegistry: ToolPackRegistry;

    constructor(
        skillRegistry: SkillRegistry,
        subagentRegistry: SubagentRegistry,
        toolRegistry: ToolRegistry,
        toolPackRegistry: ToolPackRegistry,
    ) {
        this.skillRegistry = skillRegistry;
        this.subagentRegistry = subagentRegistry;
        this.toolRegistry = toolRegistry;
        this.toolPackRegistry = toolPackRegistry;
    }

    /**
     * 根据路由决策和用户输入，动态组装需要注入的工具与 Prompt。
     * 工具预绑定流程：ToolPack 确定性匹配 → ToolRAG 模糊检索 → Pin 合并
     */
    public resolve(
        userInput: string,
        decision: RoutingDecision,
        baseSystemPrompt: string,
        session: Session,
    ): InjectionResult {
        // 1. 检查是否有 @subagent 显式唤醒
        const { agent, cleanInput } = this.subagentRegistry.resolveAtMention(userInput);
        if (agent) {
            return this.buildSubagentInjection(agent, baseSystemPrompt);
        }

        // 2. 收集需要注入的技能 (Skills)
        const skillNames = new Set<string>(decision.suggestedSkills);
        const searchHits = this.skillRegistry.searchByKeywords(userInput);
        for (const hit of searchHits) {
            skillNames.add(hit.name);
        }

        // 3. ToolPack 确定性匹配（快速路径，跳过 RAG）
        const catalog = this.toolRegistry.getCatalog();
        const matchedPacks = this.toolPackRegistry.match(
            userInput,
            (decision as any).suggestedToolPacks,
        );

        let ragToolIds: string[] = [];

        if (matchedPacks.length > 0) {
            // 命中预设包 → 直接批量加载，不走 RAG
            ragToolIds = this.toolPackRegistry.collectToolIds(matchedPacks);
        } else if (catalog.getAllEntries().length > DEFAULT_RAG_TOP_K) {
            // 大规模 Catalog 且无包命中 → ToolRAG BM25 检索
            const ragIndex = catalog.getRagIndex();
            ragToolIds = ragIndex.search(userInput, DEFAULT_RAG_TOP_K);
        } else {
            // 小规模 Catalog → 全量激活
            ragToolIds = catalog.getAllEntries().map(e => e.id);
        }

        // 写入 Session（每轮刷新）
        session.setRagTools(ragToolIds);

        // 4. 组装 System Prompt 和 Skill Tools
        const promptParts: string[] = [baseSystemPrompt, decision.systemPromptHint];
        const tools: StandardTool[] = [];

        // 构建可用技能的简短广告文本（不含完整 Schema，节省 Token）
        const allSkills = this.skillRegistry.listSkills();
        if (allSkills.length > 0) {
            const adLines = allSkills
                .filter(s => !skillNames.has(s.name))
                .map(s => `- ${s.name}: ${s.description}`)
                .join('\n');

            if (adLines) {
                promptParts.push(
                    `\nYou also have the following skills available (ask if you need them):\n${adLines}`
                );
            }
        }

        // 对于命中的技能，注入完整的 Body 和 Tool Schema
        for (const name of skillNames) {
            const skill = this.skillRegistry.getSkill(name);
            if (!skill) continue;

            const body = this.skillRegistry.getSkillBody(name);
            if (body) {
                promptParts.push(`\n--- Skill: ${skill.name} ---\n${body}`);
            }

            if (skill.tools) {
                for (const t of skill.tools) {
                    tools.push({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema,
                    });
                }
            }
        }

        return {
            systemPrompt: promptParts.filter(Boolean).join('\n\n'),
            tools,
            subagent: null,
        };
    }

    /**
     * 构建 Subagent 专属注入结果。
     * Subagent 有自己独立的 System Prompt 和工具白名单。
     */
    private buildSubagentInjection(
        agent: SubagentConfig,
        baseSystemPrompt: string
    ): InjectionResult {
        const tools: StandardTool[] = [];

        // 从 SkillRegistry 中加载 Subagent 白名单内的工具
        for (const toolName of agent.allowedTools) {
            const skill = this.skillRegistry.getSkill(toolName);
            if (skill?.tools) {
                for (const t of skill.tools) {
                    tools.push({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema,
                    });
                }
            }
        }

        return {
            systemPrompt: `${baseSystemPrompt}\n\n${agent.systemPrompt}`,
            tools,
            subagent: agent,
        };
    }
}

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
import { ProviderResolver } from '../llm/resolver.js';
import fs from 'fs';
import path from 'path';

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
     * 工具预绑定流程：ToolPack 确定性匹配 → ToolRAG 模糊检索 (通过小模型 Query 改写) → Pin 合并
     */
    public async resolve(
        parsed: import('../router/input-parser.js').ParsedInput,
        decision: RoutingDecision,
        baseSystemPrompt: string,
        session: Session,
        providerResolver: ProviderResolver,
        workspaceRoot: string,
    ): Promise<InjectionResult> {
        console.log('[DEBUG] Available agents:', this.subagentRegistry.listAgents().map(a => a.name));
        // 1. 获取目标 Agent
        let agent: SubagentConfig | null = null;

        // 1.1 检查是否存在显式 @ 唤醒
        for (const m of parsed.mentions) {
            if (m.namespace === 'agent' || m.namespace === 'raw') {
                const found = this.subagentRegistry.getAgent(m.value);
                if (found) {
                    agent = found;
                    break;
                }
            }
        }

        // 1.2 如果没有显式唤醒，采用 Session 中当前的 activeAgentId
        if (!agent && session.activeAgentId && session.activeAgentId !== 'default') {
            const found = this.subagentRegistry.getAgent(session.activeAgentId);
            if (found) {
                agent = found;
            }
        }

        // 2. 收集需要注入的技能 (Skills) - 即使有了 Agent 也要注入命中的技能工具，但仅限未被拦截的
        const skillNames = new Set<string>(decision.suggestedSkills);
        for (const s of parsed.skills) {
            skillNames.add(s.value);
        }
        const searchHits = this.skillRegistry.searchByKeywords(parsed.cleanText);
        for (const hit of searchHits) {
            skillNames.add(hit.name);
        }

        // 3. ToolPack 确定性匹配（快速路径，跳过 RAG）
        const catalog = this.toolRegistry.getCatalog();
        const matchedPacks = this.toolPackRegistry.match(
            parsed.cleanText,
            (decision as any).suggestedToolPacks,
        );

        let ragToolIds: string[] = [];

        if (matchedPacks.length > 0) {
            // 命中预设包 → 直接批量加载，不走 RAG
            ragToolIds = this.toolPackRegistry.collectToolIds(matchedPacks);
        } else if (catalog.getAllEntries().length > DEFAULT_RAG_TOP_K) {
            // 大规模 Catalog 且无包命中 → ToolRAG BM25 检索
            let rewrittenQuery = parsed.cleanText;

            // 提取最近的 AI 回复作为上下文
            let recentContext = '';
            for (let i = session.history.length - 1; i >= 0; i--) {
                const msg = session.history[i];
                if (msg.role === 'assistant' && typeof msg.content === 'string') {
                    // 取最后一次文本回复
                    recentContext = msg.content.substring(0, 500); // 取前 500 字符
                    break;
                }
            }

            try {
                const llm = providerResolver.getProvider('tool_query_rewrite');
                let responseText = '';
                await llm.generateResponseStream({
                    systemPrompt: 'You are a query rewriting assistant. Extract technical keywords and synonyms from the user query to retrieve relevant programming tools or skills. Reply only with the space-separated keywords.',
                    messages: [
                        { role: 'user', content: `Context: ${recentContext}\nUser Query: ${parsed.cleanText}` }
                    ]
                }, (event) => {
                    if (event.type === 'text') {
                        responseText += event.data;
                    }
                });

                if (responseText.trim().length > 0) {
                    rewrittenQuery = responseText.trim();
                    console.log(`[LazyInjector] Query Rewritten: ${rewrittenQuery}`);
                }
            } catch (err) {
                console.warn(`[LazyInjector] Query rewrite failed, falling back to original input. Error:`, err);
            }

            const ragIndex = catalog.getRagIndex();
            ragToolIds = ragIndex.search(rewrittenQuery, DEFAULT_RAG_TOP_K);
        } else {
            // 小规模 Catalog → 全量激活
            ragToolIds = catalog.getAllEntries().map(e => e.id);
        }

        // 写入 Session（每轮刷新）
        session.setRagTools(ragToolIds);

        // 4. 组装分层 System Prompt (Base + Agent + Mode + Context + Skills)
        const promptParts: string[] = [baseSystemPrompt];

        if (agent) {
            promptParts.push(agent.systemPrompt);

            // Context 注入 (如 tech-stack)
            if (agent.contextInject && agent.contextInject.length > 0) {
                for (const ctx of agent.contextInject) {
                    const ctxPath = path.join(workspaceRoot, '.meshy', 'context', `${ctx}.md`);
                    if (fs.existsSync(ctxPath)) {
                        const content = fs.readFileSync(ctxPath, 'utf8');
                        promptParts.push(`\n--- Workspace Context: ${ctx} ---\n${content}`);
                    }
                }
            }
        }

        if (decision.systemPromptHint) {
            promptParts.push(decision.systemPromptHint);
        }

        const tools: StandardTool[] = [];
        const hasWhitelist = agent && agent.allowedTools && agent.allowedTools.length > 0;
        const whitelistSet = hasWhitelist ? new Set(agent!.allowedTools) : null;

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
                    if (!whitelistSet || whitelistSet.has(t.name)) {
                        tools.push({
                            name: t.name,
                            description: t.description,
                            inputSchema: t.inputSchema,
                        });
                    }
                }
            }
        }

        // 把基础 Registry 中受白名单允许的工具注入 (虽然 session.activatedTools 决定实际执行，但 schema 组装可能需要)
        // 实际上 LLM loop 会利用 session.activatedTools 去取 Built-in tools
        // 但为了完整性，如果这里要完全接管的话，需要合并。暂保原样。我们用白名单阻止其调用即可。

        return {
            systemPrompt: promptParts.filter(Boolean).join('\n\n'),
            tools,
            subagent: agent,
        };
    }
}

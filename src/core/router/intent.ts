/**
 * Intent Router — 前置意图分类器
 *
 * 负责解析用户自然语言输入，将其分类为不同意图类型，
 * 并据此决定使用哪个模型规格、需要挂载哪些工具、以及组装什么样的 System Prompt。
 *
 * 设计要点：
 * - 支持基于关键词的快速本地判定（零成本，不调用 LLM）
 * - 支持可选的小模型深度意图分析（用于模糊场景）
 * - 输出标准化的 RoutingDecision，供 TaskEngine 消费
 */

import { ILLMProvider } from '../llm/provider.js';
import { ProviderResolver } from '../llm/resolver.js';

// ─── 意图类型枚举 ───
export type IntentCategory =
    | 'code_edit'        // 修改/重构代码
    | 'code_search'      // 搜索代码中的符号/定义
    | 'code_generate'    // 从头生成新模块
    | 'debug'            // 分析报错、排查 Bug
    | 'explain'          // 解释代码或概念
    | 'general_chat'     // 日常闲聊
    | 'info_retrieval'   // 信息检索（网络/API）
    | 'task_planning'    // 复杂任务拆解与规划
    | 'unknown';

// ─── 模型等级 ───
export type ModelTier = 'small' | 'default' | 'large';

// ─── 路由决策输出 ───
export interface RoutingDecision {
    intent: IntentCategory;
    modelTier: ModelTier;
    systemPromptHint: string;
    suggestedSkills: string[];       // 建议挂载的 Skill 名称
    suggestedToolPacks?: string[];   // 建议挂载的 ToolPack 名称
    confidence: number;              // 0~1
}

// ─── 关键词规则表 ───
interface KeywordRule {
    keywords: string[];
    intent: IntentCategory;
    modelTier: ModelTier;
    systemPromptHint: string;
    suggestedSkills: string[];
}

const KEYWORD_RULES: KeywordRule[] = [
    {
        keywords: ['重构', 'refactor', '修改', 'edit', '改一下', '替换', 'replace', '修复', 'fix'],
        intent: 'code_edit',
        modelTier: 'default',
        systemPromptHint: 'Focus on precise code editing. Always read the file first before making changes.',
        suggestedSkills: [],
    },
    {
        keywords: ['搜索', 'search', '找到', 'find', 'grep', '定位', 'locate', '哪里'],
        intent: 'code_search',
        modelTier: 'small',
        systemPromptHint: 'Help user search and locate code symbols or patterns efficiently.',
        suggestedSkills: [],
    },
    {
        keywords: ['生成', 'generate', '创建', 'create', '新建', '新增', 'scaffold', '写一个'],
        intent: 'code_generate',
        modelTier: 'default',
        systemPromptHint: 'Generate high-quality, production-grade code following best practices.',
        suggestedSkills: [],
    },
    {
        keywords: ['报错', 'error', 'bug', '崩溃', 'crash', '调试', 'debug', '排查', '为什么'],
        intent: 'debug',
        modelTier: 'large',
        systemPromptHint: 'Analyze the error carefully. Read relevant files and terminal output before suggesting fixes.',
        suggestedSkills: [],
    },
    {
        keywords: ['解释', 'explain', '什么意思', '为何', '原理', '怎么工作'],
        intent: 'explain',
        modelTier: 'small',
        systemPromptHint: 'Explain the concept or code clearly and concisely.',
        suggestedSkills: [],
    },
    {
        keywords: ['计划', 'plan', '拆解', '任务', '设计', '架构', 'design', 'architect'],
        intent: 'task_planning',
        modelTier: 'large',
        systemPromptHint: 'Break down the complex task into clear, actionable steps. Think step by step.',
        suggestedSkills: [],
    },
    {
        keywords: ['爬虫', 'crawl', '新闻', 'news', '查询', 'query', '搜一下', 'web search', '网上'],
        intent: 'info_retrieval',
        modelTier: 'default',
        systemPromptHint: 'Retrieve and synthesize information from external sources.',
        suggestedSkills: ['web-search'],
    },
];

/**
 * 基于关键词的快速本地意图路由（零 LLM 开销）。
 * 扫描用户输入，命中规则表中权重最高的匹配项。
 */
function classifyByKeywords(userInput: string): RoutingDecision {
    const lowerInput = userInput.toLowerCase();

    let bestMatch: KeywordRule | null = null;
    let bestScore = 0;

    for (const rule of KEYWORD_RULES) {
        const hitCount = rule.keywords.filter(kw => lowerInput.includes(kw)).length;
        if (hitCount > bestScore) {
            bestScore = hitCount;
            bestMatch = rule;
        }
    }

    if (bestMatch && bestScore > 0) {
        return {
            intent: bestMatch.intent,
            modelTier: bestMatch.modelTier,
            systemPromptHint: bestMatch.systemPromptHint,
            suggestedSkills: bestMatch.suggestedSkills,
            confidence: Math.min(bestScore * 0.3, 1),
        };
    }

    // Fallback: general_chat
    return {
        intent: 'general_chat',
        modelTier: 'small',
        systemPromptHint: 'Respond helpfully and concisely.',
        suggestedSkills: [],
        confidence: 0.1,
    };
}

/**
 * IntentRouter — 系统前置意图路由器
 *
 * 双轨判定：纯关键词匹配（零成本） + 可选的小模型结构化 Tool Calling 深度分析。
 */
export class IntentRouter {
    private providerResolver?: ProviderResolver;

    constructor(providerResolver?: ProviderResolver) {
        this.providerResolver = providerResolver;
    }

    /**
     * 对用户输入进行意图分类，返回路由决策。
     * 优先走零成本的本地关键词匹配，
     * 仅当置信度不足且小模型可用时，才走 LLM 分类。
     */
    public async classify(userInput: string): Promise<RoutingDecision> {
        const localResult = classifyByKeywords(userInput);

        // 如果本地判定置信度足够，直接返回
        if (localResult.confidence >= 0.3) {
            return localResult;
        }

        // 如果有 ProviderResolver 且置信度低，走 LLM 辅助判定
        if (this.providerResolver) {
            return this.classifyByLLM(userInput, localResult);
        }

        return localResult;
    }

    /**
     * 使用小模型进行深度意图分析（可选路径）。
     * 通过 Tool Calling 让小模型返回结构化的意图分类，避免原始文本解析不稳定。
     */
    private async classifyByLLM(
        userInput: string,
        fallback: RoutingDecision
    ): Promise<RoutingDecision> {
        if (!this.providerResolver) return fallback;
        const llm = this.providerResolver.getProvider('intent_routing');

        const classifyTool = {
            name: 'classify_intent',
            description: 'Classify user intent into a structured category',
            inputSchema: {
                type: 'object' as const,
                properties: {
                    intent: {
                        type: 'string',
                        enum: [
                            'code_edit', 'code_search', 'code_generate',
                            'debug', 'explain', 'general_chat',
                            'info_retrieval', 'task_planning',
                        ],
                        description: 'The classified intent category',
                    },
                    confidence: {
                        type: 'number',
                        description: 'Confidence score between 0 and 1',
                    },
                    suggestedSkills: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Relevant skill names to activate',
                    },
                },
                required: ['intent', 'confidence'],
            },
        };

        try {
            let toolCallArgs = '';

            await llm.generateResponseStream(
                {
                    systemPrompt: 'You are an intent classifier. Analyze the user input and call the classify_intent tool with the appropriate category and confidence.',
                    messages: [{ role: 'user', content: userInput }],
                    tools: [classifyTool],
                },
                (event) => {
                    if (event.type === 'tool_call_chunk') {
                        toolCallArgs += event.data;
                    }
                }
            );

            if (!toolCallArgs) return fallback;

            const parsed = JSON.parse(toolCallArgs);
            const intent = parsed.intent as IntentCategory;
            const matchedRule = KEYWORD_RULES.find(r => r.intent === intent);

            return {
                intent,
                modelTier: matchedRule?.modelTier ?? 'default',
                systemPromptHint: matchedRule?.systemPromptHint ?? '',
                suggestedSkills: parsed.suggestedSkills ?? matchedRule?.suggestedSkills ?? [],
                confidence: parsed.confidence ?? 0.5,
            };
        } catch {
            // LLM 分类失败，退回本地结果
            return fallback;
        }
    }
}

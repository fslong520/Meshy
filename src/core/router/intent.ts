/**
 * Intent Router — 前置意图分类器
 *
 * 负责解析用户自然语言输入，将其分类为不同意图类型，
 * 并据此决定使用哪个模型规格、需要挂载哪些工具、以及组装什么样的 System Prompt。
 *
 * 设计要点：
 * - 三层分类架构：
 *   第一层：零成本的纯关键词快速分类
 *   第二层：ERNIE-4.5-0.3B 本地小模型深度分类（低功耗、低延迟）
 *   第三层：当本地模型也无法确定时，回退到远程大模型 LLM 分类
 * - 输出标准化的 RoutingDecision，供 TaskEngine 消费
 *
 * 本设计遵循 openKylin 终极任务的"小模型分类、大模型执行"的分层思想。
 */

import { ILLMProvider } from '../llm/provider.js';
import { ProviderResolver } from '../llm/resolver.js';
import { LocalERNIEAdapter } from '../llm/local-ernie.js';

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
    /** 标记本分类使用的技术路径 */
    classificationMethod?: 'keyword' | 'ernie_0.3b' | 'remote_llm';
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
        keywords: ['重构', 'refactor', '修改', 'edit', '改一下', '替换', 'replace', '修复', 'fix', '优化'],
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
        keywords: ['解释', 'explain', '什么意思', '为何', '原理', '怎么工作', '是什么'],
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
        keywords: ['爬虫', 'crawl', '新闻', 'news', '查询', 'query', '搜一下', '网上', '搜索一下'],
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
            classificationMethod: 'keyword',
        };
    }

    // Fallback: general_chat
    return {
        intent: 'general_chat',
        modelTier: 'small',
        systemPromptHint: 'Respond helpfully and concisely.',
        suggestedSkills: [],
        confidence: 0.1,
        classificationMethod: 'keyword',
    };
}

/**
 * IntentRouter — 系统前置意图路由器
 *
 * 三层判定系统：
 *   ① 纯关键词匹配（零成本，速度最快）
 *   ② ERNIE-4.5-0.3B 本地小模型分类（低功耗，保护隐私）
 *   ③ 远程大模型 LLM 分类（最终保底方案）
 */
export class IntentRouter {
    private providerResolver?: ProviderResolver;
    private localERNIE?: LocalERNIEAdapter;

    constructor(providerResolver?: ProviderResolver, localERNIE?: LocalERNIEAdapter) {
        this.providerResolver = providerResolver;
        this.localERNIE = localERNIE;
    }

    /**
     * 对用户输入进行意图分类，返回路由决策。
     *
     * 流程：
     *   keyword → 置信度足够？→ 是 → 返回
     *            → 否 → ERNIE-0.3B 可用？→ 是 → ERNIE 分类
     *                                        → 否 → 远程 LLM 分类（如果有）
     *                                              → 否 → 返回 keyword 结果
     */
    public async classify(userInput: string): Promise<RoutingDecision> {
        // 第一层：纯关键词匹配（零成本）
        const localResult = classifyByKeywords(userInput);

        // 如果本地判定置信度足够，直接返回
        if (localResult.confidence >= 0.3) {
            return localResult;
        }

        // 第二层：使用 ERNIE-4.5-0.3B 本地小模型进行深度分析
        if (this.localERNIE) {
            try {
                const ernieResult = await this.localERNIE.classifyIntent(
                    userInput,
                    { intent: localResult.intent, confidence: localResult.confidence }
                );

                // 如果小模型给出的置信度足够，采纳之
                if (ernieResult.confidence >= 0.35) {
                    const matchedRule = KEYWORD_RULES.find(r => r.intent === ernieResult.intent);
                    console.log(
                        `[IntentRouter] ERNIE-0.3B classified intent="${ernieResult.intent}" ` +
                        `confidence=${ernieResult.confidence.toFixed(2)} ` +
                        `reasoning="${ernieResult.reasoning || ''}"`
                    );

                    return {
                        intent: ernieResult.intent as IntentCategory,
                        modelTier: matchedRule?.modelTier ?? 'small',
                        systemPromptHint: matchedRule?.systemPromptHint ?? '',
                        suggestedSkills: matchedRule?.suggestedSkills ?? [],
                        confidence: ernieResult.confidence,
                        classificationMethod: 'ernie_0.3b',
                    };
                }

                // 小模型给出了分类但置信度偏低，仍记录日志供调试
                console.log(
                    `[IntentRouter] ERNIE-0.3B returned low confidence ` +
                    `(${ernieResult.confidence.toFixed(2)}), keeping keyword result.`
                );
            } catch (err: any) {
                console.warn(`[IntentRouter] ERNIE-0.3B classification failed: ${err.message}. Falling through.`);
            }
        }

        // 第三层：如果有远程 LLM 且本地模型不可用或不确定，走 LLM 辅助判定
        if (this.providerResolver) {
            return this.classifyByLLM(userInput, localResult);
        }

        return {
            ...localResult,
            classificationMethod: 'keyword',
        };
    }

    /**
     * 使用远程大模型进行深度意图分析（最终保底方案）。
     * 仅在本地关键词和 ERNIE-0.3B 都无法确定时调用。
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

            if (!toolCallArgs) {
                return {
                    ...fallback,
                    classificationMethod: 'remote_llm',
                };
            }

            const parsed = JSON.parse(toolCallArgs);
            const intent = parsed.intent as IntentCategory;
            const matchedRule = KEYWORD_RULES.find(r => r.intent === intent);

            return {
                intent,
                modelTier: matchedRule?.modelTier ?? 'default',
                systemPromptHint: matchedRule?.systemPromptHint ?? '',
                suggestedSkills: parsed.suggestedSkills ?? matchedRule?.suggestedSkills ?? [],
                confidence: parsed.confidence ?? 0.5,
                classificationMethod: 'remote_llm',
            };
        } catch {
            // LLM 分类失败，退回本地结果
            return {
                ...fallback,
                classificationMethod: 'keyword',
            };
        }
    }
}

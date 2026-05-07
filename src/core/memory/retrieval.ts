/**
 * HumanLikeRetriever — 类人记忆检索引擎
 *
 * 核心设计源自「忆时」记忆胶囊系统：
 * 模拟人类记忆的检索方式，而非数据库精确查询。
 *
 * 综合得分 = 0.40 × 语义相似度
 *          + 0.15 × 情绪权重
 *          + 0.20 × 近因效应 (遗忘曲线)
 *          + 0.25 × 频率强化
 *
 * 特性：
 * - 遗忘曲线：记忆指数衰减，半衰期30天
 * - 情绪锚定：高情绪记忆权重更高，不易遗忘
 * - 联想扩散：通过关系图谱扩展关联记忆
 * - 渐进式回忆：分轮返回，先抛最相关1-2条
 * - 记忆涌现：话题转换时主动发现隐藏关联
 */

import { MemoryStore, Capsule, RetrievalRequest, RetrievalResult, EmotionLevel, EMOTION_WEIGHTS } from './store.js';

// ─── 默认权重配置（源自「忆时」设计） ───
export const DEFAULT_WEIGHTS = {
    semantic: 0.40,
    emotion:  0.15,
    recency:  0.20,
    frequency: 0.25,
} as const;

/** 遗忘曲线半衰期（天） */
export const RECENCY_HALF_LIFE_DAYS = 30;

/** 渐进式回忆各轮返回数量 */
export const PROGRESSIVE_TIER_LIMITS: Record<number, number> = {
    1: 1,   // 第一轮：只返回最相关的 1 条
    2: 3,   // 第二轮：再返回 2 条（累计 3 条）
    3: 10,  // 第三轮：展开联想扩散，返回更多
};

/** 联想扩散阈值 */
const EXPAND_ASSOCIATION_THRESHOLD = 0.6;

/** 遗忘不确定性阈值 */
const FORGETTING_UNCERTAINTY_THRESHOLD = 0.2;

/** 涌现检测阈值 */
const EMERGENCE_THRESHOLD = 0.65;

export class HumanLikeRetriever {
    private store: MemoryStore;

    constructor(store: MemoryStore) {
        this.store = store;
    }

    // ═══════════════════════════════════════════
    // 主检索入口
    // ═══════════════════════════════════════════

    /**
     * 执行类人记忆检索（多维度加权）。
     *
     * @param req 检索请求（查询文本、扩展开关、渐进步数等）
     * @returns 按综合得分降序排列的检索结果
     */
    public async recall(req: RetrievalRequest): Promise<RetrievalResult[]> {
        const limit = req.limit || 5;

        // Step 1: 基础语义检索
        const semanticResults = await this.store.searchCapsules(req.query, limit * 3);
        if (semanticResults.length === 0) return [];

        // Step 2: 为每条结果计算综合得分
        let scored: RetrievalResult[] = semanticResults.map(capsule => {
            return this.computeScore(capsule, req.query);
        });

        // Step 3: 按综合得分排序
        scored.sort((a, b) => b.combinedScore - a.combinedScore);

        // Step 4: 应用过滤条件
        if (req.categoryFilter) {
            scored = scored.filter(r => r.capsule.category === req.categoryFilter);
        }
        const minEmotionWeight = req.minEmotionWeight;
        if (minEmotionWeight !== undefined) {
            scored = scored.filter(r => (r.capsule.emotionWeight ?? 0) >= minEmotionWeight!);
        }
        if (req.lockedOnly) {
            scored = scored.filter(r => r.capsule.isLocked === true);
        }
        if (req.unlockedOnly) {
            scored = scored.filter(r => !r.capsule.isLocked);
        }

        // Step 5: 遗忘曲线 — 综合分过低的记忆标记为"模糊"
        // 但保留在结果中，让调用方决定如何处理
        // 实际上这里不过滤，而是在格式化输出时处理

        // Step 6: 联想扩散（如果启用）
        if (req.expand) {
            const expanded = await this.expandResults(scored);
            // 将扩散结果合并（去重）
            const existingIds = new Set(scored.map(r => r.capsule.id));
            for (const e of expanded) {
                if (!existingIds.has(e.capsule.id)) {
                    e.isExpanded = true;
                    scored.push(e);
                    existingIds.add(e.capsule.id);
                }
            }
            // 重新排序
            scored.sort((a, b) => b.combinedScore - a.combinedScore);
        }

        // Step 7: 渐进式裁剪（根据 tier）
        const tier = req.progressiveTier || 3;
        const tierLimit = PROGRESSIVE_TIER_LIMITS[tier] || limit;
        const finalResults = scored.slice(0, Math.max(tierLimit, limit));

        // Step 8: 更新召回计数（追踪频率强化因子）
        const recalledIds = finalResults.map(r => r.capsule.id!).filter(Boolean);
        this.store.incrementRecallCounts(recalledIds).catch(() => {});

        return finalResults;
    }

    // ═══════════════════════════════════════════
    // 综合得分计算
    // ═══════════════════════════════════════════

    /**
     * 为单条记忆计算多维度综合得分。
     *
     * 公式（源自「忆时」）：
     *   最终得分 = 0.40 × 语义相似度
     *            + 0.15 × 情绪权重
     *            + 0.20 × 近因效应
     *            + 0.25 × 频率强化
     */
    public computeScore(capsule: Capsule, query?: string): RetrievalResult {
        // 语义相似度（40%）：来自向量搜索的 distance，转为相似度
        // distance 是余弦距离（0=完全相同, 1=完全不相关）
        const semanticScore = capsule.distance !== undefined
            ? Math.max(0, 1 - capsule.distance)
            : 0.5; // 无向量时取中值

        // 情绪权重（15%）：直接取自存储的 emotion_weight
        const emotionScore = capsule.emotionWeight ?? 0;

        // 近因效应（20%）：遗忘曲线，半衰期 30 天
        const recencyScore = this.computeRecency(capsule.createdAt);

        // 频率强化（25%）：recall_count 和频次
        const frequencyScore = this.computeFrequency(capsule.recallCount);

        // 综合得分
        const combinedScore =
            DEFAULT_WEIGHTS.semantic * semanticScore +
            DEFAULT_WEIGHTS.emotion * emotionScore +
            DEFAULT_WEIGHTS.recency * recencyScore +
            DEFAULT_WEIGHTS.frequency * frequencyScore;

        return {
            capsule,
            combinedScore: Math.min(1, Math.max(0, combinedScore)),
            semanticScore,
            emotionScore,
            recencyScore,
            frequencyScore,
        };
    }

    /**
     * 遗忘曲线：近因效应计算。
     *
     * 公式：exp(-ln(2) × 天数 / 半衰期)
     * 半衰期 = 30 天，30 天后回忆概率减半。
     */
    private computeRecency(createdAt?: string): number {
        if (!createdAt) return 0.5; // 未知时间取中值

        const created = new Date(createdAt).getTime();
        const now = Date.now();
        const daysElapsed = (now - created) / (1000 * 60 * 60 * 24);

        if (daysElapsed <= 0) return 1.0;

        // 指数衰减
        return Math.exp(-Math.LN2 * daysElapsed / RECENCY_HALF_LIFE_DAYS);
    }

    /**
     * 频率强化计算。
     *
     * 公式：0.6 + log₂(f+1) × 0.1 + log₂(r+1) × 0.05
     * f = recall_count, r = 被回忆次数
     */
    private computeFrequency(recallCount?: number): number {
        const f = recallCount ?? 0;
        const r = 0; // 没有二次回忆次数，简化用
        return Math.min(1.0, 0.6 + Math.log2(f + 1) * 0.1 + Math.log2(r + 1) * 0.05);
    }

    /**
     * 判断一条记忆是否处于"模糊"状态（遗忘曲线所致）。
     * 综合分 < 0.5 或近因分 < 0.2 时，记忆被判定为模糊。
     */
    public isFuzzy(result: RetrievalResult): boolean {
        return result.combinedScore < 0.5 || result.recencyScore < FORGETTING_UNCERTAINTY_THRESHOLD;
    }

    // ═══════════════════════════════════════════
    // 联想扩散
    // ═══════════════════════════════════════════

    /**
     * 对已有的检索结果做联想扩散。
     * 取 top-3 结果，通过关系图谱做 1 度关联扩展。
     */
    private async expandResults(baseResults: RetrievalResult[]): Promise<RetrievalResult[]> {
        const topResults = baseResults.slice(0, 3);
        const expanded: RetrievalResult[] = [];

        for (const result of topResults) {
            const capsuleId = result.capsule.id;
            if (!capsuleId) continue;

            try {
                const related = await this.store.expandViaRelationships([capsuleId], 3);
                for (const relCapsule of related) {
                    // 为关联到的记忆计算得分（以较低的联想权重加入）
                    const score = this.computeScore(relCapsule);
                    // 关联扩散的记忆综合分打折扣
                    score.combinedScore *= EXPAND_ASSOCIATION_THRESHOLD;
                    expanded.push(score);
                }
            } catch {
                // 关系图谱检索失败时不阻塞
            }
        }

        return expanded;
    }

    // ═══════════════════════════════════════════
    // 记忆涌现检测
    // ═══════════════════════════════════════════

    /**
     * 检测当前话题是否触发了记忆涌现。
     * 当新话题与已有记忆之间存在高关联度时，返回涌现结果。
     *
     * @param currentTopic 当前对话话题/关键词
     * @param recentMemoryIds 本轮已提及的记忆 ID（避免重复涌现）
     * @returns 涌现的记忆列表（附带关联描述）
     */
    public async detectEmergence(
        currentTopic: string,
        recentMemoryIds: Set<number> = new Set(),
    ): Promise<{ capsule: Capsule; emergenceScore: number; relationDescription: string }[]> {
        // 用当前话题做语义检索
        const results = await this.store.searchCapsules(currentTopic, 10);
        if (results.length === 0) return [];

        const emergences: { capsule: Capsule; emergenceScore: number; relationDescription: string }[] = [];

        for (const capsule of results) {
            if (recentMemoryIds.has(capsule.id!)) continue;

            const score = this.computeScore(capsule, currentTopic);

            // 涌现条件：综合分 > 阈值，且不是当前对话已提及的
            if (score.combinedScore >= EMERGENCE_THRESHOLD) {
                // 检查是否有关系链（关系图谱中的关联）
                let relationDesc = this.inferRelationDescription(capsule, score, currentTopic);

                emergences.push({
                    capsule,
                    emergenceScore: score.combinedScore,
                    relationDescription: relationDesc,
                });
            }

            // 最多返回 2 条涌现
            if (emergences.length >= 2) break;
        }

        return emergences;
    }

    /**
     * 根据得分情况推断涌现的关联描述。
     */
    private inferRelationDescription(capsule: Capsule, score: RetrievalResult, topic: string): string {
        const parts: string[] = [];

        if (capsule.emotion && capsule.emotion !== 'none') {
            const emotionLabels: Record<EmotionLevel, string> = {
                high: '印象深刻的',
                medium: '有些感触的',
                low: '淡淡提及的',
                none: '',
            };
            if (emotionLabels[capsule.emotion]) {
                parts.push(emotionLabels[capsule.emotion]);
            }
        }

        if (score.frequencyScore > 0.8) {
            parts.push('反复提到的');
        }

        if (score.recencyScore < 0.3) {
            parts.push('很久以前的');
        }

        const base = parts.length > 0 ? parts.join('') : '相关的';

        return `${base}记忆：「${capsule.summary.slice(0, 40)}${capsule.summary.length > 40 ? '…' : ''}」`;
    }

    // ═══════════════════════════════════════════
    // 渐进式回忆格式化输出
    // ═══════════════════════════════════════════

    /**
     * 将检索结果格式化为人类可读的记忆文本（用于注入 System Prompt）。
     */
    public formatResults(results: RetrievalResult[], includeFuzzyMarker: boolean = true): string {
        if (results.length === 0) return '';

        const lines = results.map((r, i) => {
            const icon = r.capsule.category === 'anti_pattern' ? '⚠️' : '✅';
            const fuzzy = includeFuzzyMarker && this.isFuzzy(r) ? ' [记忆模糊]' : '';
            const expandMark = r.isExpanded ? ' [联想扩散]' : '';
            const locked = r.capsule.isLocked ? ' [封存]' : '';
            const emotion = r.capsule.emotion && r.capsule.emotion !== 'none'
                ? ` [情绪:${r.capsule.emotion}]` : '';

            return `${i + 1}. ${icon}${emotion}${fuzzy}${expandMark}${locked} ${r.capsule.summary}`;
        });

        return [
            '--- Project Memory: Relevant Past Experiences (Human-like Recall) ---',
            ...lines,
            '--- End of Project Memory ---',
        ].join('\n');
    }

    /**
     * 获取涌现记忆的格式化文本（口语化，适合直接说出）。
     */
    public formatEmergence(emergences: Array<{ capsule: Capsule; emergenceScore: number; relationDescription: string }>): string {
        if (emergences.length === 0) return '';

        return emergences.map(e => {
            return `说到这个我突然想到一件${e.relationDescription}。`;
        }).join('\n');
    }
}

/**
 * Emergence Detector — 记忆涌现检测模块
 *
 * 源自「忆时」记忆胶囊系统的核心概念之一：记忆涌现。
 *
 * 人类的记忆不是孤立的——当谈论一个新话题时，
 * 大脑会自动检索相关记忆并"涌现"到意识中，
 * 即使这些记忆与当前话题并非直接相关，而是通过
 * 多层联想链连接。
 *
 * 本模块负责：
 * 1. 在话题转换时检测潜在的记忆涌现
 * 2. 通过语义相似度 + 关系图谱双重路径发现隐藏关联
 * 3. 生成口语化的涌现提示，供 AI 主动表达
 */

import { MemoryStore, Capsule, EMOTION_WEIGHTS } from './store.js';
import { HumanLikeRetriever } from './retrieval.js';

export interface EmergenceEvent {
    capsule: Capsule;
    emergenceScore: number;
    /** 涌现的描述文本（可直接用于对话） */
    utterance: string;
    /** 涌现路径：semantic（语义联想）| relational（关系图谱）| hybrid（两者皆有） */
    path: 'semantic' | 'relational' | 'hybrid';
}

/**
 * 涌现检测配置
 */
export interface EmergenceConfig {
    /** 涌现触发最低阈值（默认 0.65） */
    threshold: number;
    /** 单次对话最大涌现次数（避免过度涌现） */
    maxPerSession: number;
    /** 涌现冷却：同一记忆在多少条消息内不重复涌现 */
    cooldownMessages: number;
}

const DEFAULT_CONFIG: EmergenceConfig = {
    threshold: 0.65,
    maxPerSession: 2,
    cooldownMessages: 10,
};

export class EmergenceDetector {
    private retriever: HumanLikeRetriever;
    private store: MemoryStore;
    private config: EmergenceConfig;

    /** 当前对话中已涌现过的记忆 ID → 最后一次涌现的消息序号 */
    private emergedHistory: Map<number, number> = new Map();
    private messageIndex: number = 0;

    constructor(retriever: HumanLikeRetriever, store: MemoryStore, config?: Partial<EmergenceConfig>) {
        this.retriever = retriever;
        this.store = store;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 处理新消息，检测是否触发记忆涌现。
     * 应在每次用户消息后调用。
     *
     * @param userMessage 用户输入的文本
     * @param currentTopic 当前话题关键词（可从意图路由中提取）
     * @returns 涌现事件列表（可能为空）
     */
    public async processMessage(userMessage: string, currentTopic?: string): Promise<EmergenceEvent[]> {
        this.messageIndex++;
        const topic = currentTopic || this.extractKeywords(userMessage);

        // 使用语义检索检测涌现
        const semanticResults = await this.store.searchCapsules(topic, 15);
        if (semanticResults.length === 0) return [];

        const events: EmergenceEvent[] = [];

        for (const capsule of semanticResults) {
            // 跳过已涌现过的
            if (this.isOnCooldown(capsule.id!)) continue;

            const score = this.retriever.computeScore(capsule, topic);

            if (score.combinedScore >= this.config.threshold) {
                // 检查关系路径
                let path: EmergenceEvent['path'] = 'semantic';

                // 检查是否有关系图谱中的强关联
                try {
                    const rels = await this.store.getRelationships(capsule.id!);
                    if (rels.some(r => r.strength > 0.7)) {
                        path = score.combinedScore > 0.8 ? 'hybrid' : 'relational';
                    }
                } catch {
                    // 关系图谱检索失败，忽略
                }

                const utterance = this.generateUtterance(capsule, score, path);
                events.push({
                    capsule,
                    emergenceScore: score.combinedScore,
                    utterance,
                    path,
                });

                // 记录涌现历史
                this.emergedHistory.set(capsule.id!, this.messageIndex);

                // 不超过最大涌现次数
                if (events.length >= this.config.maxPerSession) break;
            }
        }

        return events;
    }

    /**
     * 重置涌现历史（新对话开始时调用）。
     */
    public reset(): void {
        this.emergedHistory.clear();
        this.messageIndex = 0;
    }

    /**
     * 检查记忆是否在冷却期内。
     */
    private isOnCooldown(capsuleId: number): boolean {
        const lastEmerged = this.emergedHistory.get(capsuleId);
        if (lastEmerged === undefined) return false;
        return (this.messageIndex - lastEmerged) < this.config.cooldownMessages;
    }

    /**
     * 从用户消息中提取关键词（简易实现）。
     */
    private extractKeywords(message: string): string {
        // 移除标点符号，取前 50 个字符作为查询
        const cleaned = message.replace(/[^\w\s\u4e00-\u9fff]/g, ' ').trim();
        return cleaned.slice(0, 100);
    }

    /**
     * 生成口语化的涌现表达文本。
     */
    private generateUtterance(capsule: Capsule, score: ReturnType<HumanLikeRetriever['computeScore']>, path: EmergenceEvent['path']): string {
        const summary = capsule.summary.length > 50
            ? capsule.summary.slice(0, 50) + '…'
            : capsule.summary;

        // 根据情绪决定语气
        const emotionIntro = capsule.emotion === 'high'
            ? '，印象特别深刻'
            : capsule.emotion === 'medium'
                ? '，还有些印象'
                : '';

        // 根据联想路径决定措辞
        if (path === 'relational') {
            return `说到这个让我想起一件和你之前经历相关的事${emotionIntro}——「${summary}」`;
        }
        if (path === 'hybrid') {
            return `啊，这让我联想到你之前说过的一段经历${emotionIntro}：${summary}`;
        }
        // semantic
        return `说起来我突然想到${emotionIntro}，你之前提到过：${summary}`;
    }
}

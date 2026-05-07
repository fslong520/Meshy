/**
 * Memory Module — 记忆系统
 *
 * 融合「忆时」记忆胶囊系统的类人记忆设计理念：
 * - 类人检索（多维度加权）：HumanLikeRetriever
 * - 遗忘曲线与情绪锚定
 * - 联想扩散（关系图谱）
 * - 时间胶囊（封存/到期解锁）
 * - 记忆涌现检测：EmergenceDetector
 * - 经验萃取：ReflectionEngine
 * - 长期记忆整合：MemoryConsolidationAgent
 * - 数据持久化：MemoryStore
 */

export { MemoryStore } from './store.js';
export type {
    Capsule, Preference, EmotionLevel,
    MemoryRelationship, RetrievalRequest, RetrievalResult,
} from './store.js';
export { EMOTION_WEIGHTS } from './store.js';

export { ReflectionEngine } from './reflection.js';
export type { FeedbackType, ReflectionRequest, ReflectionResult } from './reflection.js';

export { MemoryConsolidationAgent } from './consolidation.js';

export { HumanLikeRetriever } from './retrieval.js';
export { DEFAULT_WEIGHTS, RECENCY_HALF_LIFE_DAYS, PROGRESSIVE_TIER_LIMITS } from './retrieval.js';

export { EmergenceDetector } from './emergence.js';
export type { EmergenceEvent, EmergenceConfig } from './emergence.js';

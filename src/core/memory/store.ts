import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { ILLMProvider } from '../llm/provider.js';

// ─── 情绪等级（源自「忆时」记忆胶囊系统设计） ───
export type EmotionLevel = 'high' | 'medium' | 'low' | 'none';

/** 情绪权重映射 */
export const EMOTION_WEIGHTS: Record<EmotionLevel, number> = {
    high:   0.8,   // 🔴 极/高 — 几乎不会遗忘
    medium: 0.5,   // 🟡 中 — 有情绪锚定
    low:    0.2,   // 🟢 低 — 轻微印记
    none:   0.0,   // ⚪ 无情绪 — 纯事实
};

// ─── 知识胶囊（增强版：融入忆时设计理念） ───
export interface Capsule {
    id?: number;
    sessionId: string;
    summary: string;
    tags: string[];
    category: 'success_pattern' | 'anti_pattern' | 'preference' | 'knowledge';
    embedding?: number[];
    createdAt?: string;
    distance?: number; // Used when returning semantic search results

    // ── 忆时增强字段 ──
    /** 情绪等级（影响检索权重，高情绪记忆不易遗忘） */
    emotion?: EmotionLevel;
    /** 情绪权重（由 emotion 等级换算，存储以加速查询） */
    emotionWeight?: number;
    /** 被回忆次数（频率强化因子） */
    recallCount?: number;
    /** 最后一次被回忆的时间（近因效应） */
    lastRecalledAt?: string;

    // ── 时间胶囊字段 ──
    /** 是否被封存（时间胶囊模式） */
    isLocked?: boolean;
    /** 封存解锁日期（到期自动解封） */
    unlockAt?: string;

    // ── 综合得分（多维度检索计算结果） ──
    combinedScore?: number;
    /** 语义相似度分量 */
    semanticScore?: number;
    /** 近因分量 */
    recencyScore?: number;
    /** 频率分量 */
    frequencyScore?: number;
}

// ─── 记忆关系（联想扩散用） ───
export interface MemoryRelationship {
    id?: number;
    sourceCapsuleId: number;
    targetCapsuleId: number;
    relationType: 'associative' | 'causal' | 'contrast' | 'temporal';
    strength: number;       // 0.0 ~ 1.0
    createdAt?: string;
}

// ─── 检索请求参数 ───
export interface RetrievalRequest {
    query: string;
    limit?: number;
    /** 启用联想扩散（默认 false） */
    expand?: boolean;
    /** 按类型过滤 */
    categoryFilter?: Capsule['category'];
    /** 最低情绪权重（情绪锚定检索） */
    minEmotionWeight?: number;
    /** 仅检索封存胶囊 */
    lockedOnly?: boolean;
    /** 仅检索未封存胶囊 */
    unlockedOnly?: boolean;
    /** 渐进步数：1=只返回top-1, 2=返回top-3, 3=全部展开 */
    progressiveTier?: 1 | 2 | 3;
}

// ─── 检索结果 ───
export interface RetrievalResult {
    capsule: Capsule;
    combinedScore: number;
    semanticScore: number;
    emotionScore: number;
    recencyScore: number;
    frequencyScore: number;
    /** 是否为联想扩散而来的记忆 */
    isExpanded?: boolean;
}

// ─── 用户偏好 ───
export interface Preference {
    key: string;
    value: string;
}

export class MemoryStore {
    private client: Client;
    private dbPath: string;
    private embeddingProvider?: ILLMProvider;

    constructor(workspaceRoot: string = process.cwd(), embeddingProvider?: ILLMProvider | null) {
        const meshyDir = path.join(workspaceRoot, '.meshy');
        if (!fs.existsSync(meshyDir)) {
            fs.mkdirSync(meshyDir, { recursive: true });
        }

        this.dbPath = path.join(meshyDir, 'memory.db');
        this.client = createClient({
            url: `file:${this.dbPath}`,
        });
        if (embeddingProvider) {
            this.embeddingProvider = embeddingProvider;
        }
    }

    /**
     * 初始化数据库 schema。幂等操作，启动时调用。
     * 使用 Turso / libSQL 的原生 vector 数据类型。
     * 增强版：融入「忆时」记忆胶囊系统的类人记忆设计。
     */
    public async initialize(): Promise<void> {
        // 分步初始化：先建表（无新列索引），再迁移列，最后建新列索引
        // 避免旧表缺少新列时 CREATE INDEX 导致 batch 整体失败
        await this.client.batch([
            `CREATE TABLE IF NOT EXISTS capsules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                category TEXT NOT NULL DEFAULT 'knowledge',
                embedding FLOAT32(768),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
            `CREATE TABLE IF NOT EXISTS preferences (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
            `CREATE TABLE IF NOT EXISTS skills (
                name TEXT PRIMARY KEY,
                description TEXT NOT NULL DEFAULT '',
                keywords TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT 'project',
                file_path TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
            `CREATE TABLE IF NOT EXISTS memory_relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_capsule_id INTEGER NOT NULL,
                target_capsule_id INTEGER NOT NULL,
                relation_type TEXT NOT NULL DEFAULT 'associative',
                strength REAL NOT NULL DEFAULT 0.5,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (source_capsule_id) REFERENCES capsules(id) ON DELETE CASCADE,
                FOREIGN KEY (target_capsule_id) REFERENCES capsules(id) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_category ON capsules(category)`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_session ON capsules(session_id)`,
            `CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source)`,
        ]);

        // ── 第二步：检测并迁移缺失的列 ──
        try {
            const tableInfo = await this.client.execute(`PRAGMA table_info(capsules)`);
            const existingColumns = new Set(tableInfo.rows.map(r => String(r.name)));

            const migrations: Array<{ name: string; sql: string }> = [
                { name: 'emotion',          sql: `ALTER TABLE capsules ADD COLUMN emotion TEXT DEFAULT 'none'` },
                { name: 'emotion_weight',    sql: `ALTER TABLE capsules ADD COLUMN emotion_weight REAL DEFAULT 0.0` },
                { name: 'recall_count',      sql: `ALTER TABLE capsules ADD COLUMN recall_count INTEGER DEFAULT 0` },
                { name: 'last_recalled_at',  sql: `ALTER TABLE capsules ADD COLUMN last_recalled_at TEXT` },
                { name: 'is_locked',         sql: `ALTER TABLE capsules ADD COLUMN is_locked INTEGER DEFAULT 0` },
                { name: 'unlock_at',         sql: `ALTER TABLE capsules ADD COLUMN unlock_at TEXT` },
            ];

            for (const m of migrations) {
                if (!existingColumns.has(m.name)) {
                    console.log(`[MemoryStore] Migrating: adding column "${m.name}" to capsules table`);
                    await this.client.execute(m.sql);
                }
            }
        } catch (err) {
            console.warn('[MemoryStore] Column migration failed, will retry on next init:', err);
        }

        // ── 第三步：为新列建索引（在确认列存在后执行，避免旧表无列导致整体失败） ──
        const newIndexes = [
            `CREATE INDEX IF NOT EXISTS idx_capsules_emotion ON capsules(emotion)`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_locked ON capsules(is_locked)`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_unlock ON capsules(unlock_at)`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_recalled ON capsules(last_recalled_at)`,
            `CREATE INDEX IF NOT EXISTS idx_relationships_source ON memory_relationships(source_capsule_id)`,
            `CREATE INDEX IF NOT EXISTS idx_relationships_target ON memory_relationships(target_capsule_id)`,
        ];
        for (const sql of newIndexes) {
            try { await this.client.execute(sql); } catch { /* index may already exist or column may not exist yet */ }
        }
    }

    // ═══════════════════════════════════════════
    // Capsule CRUD
    // ═══════════════════════════════════════════

    /**
     * 写入一条知识胶囊。如果有传入 embeddingProvider，自动为其生成 Embedding 并存储。
     * 增强版：支持情绪等级、时间胶囊等「忆时」类人记忆字段。
     * 如新列尚不存在，自动降级为旧 schema 插入。
     */
    public async addCapsule(capsule: Capsule): Promise<number> {
        let embedding = capsule.embedding;

        if (!embedding && this.embeddingProvider && this.embeddingProvider.supportsEmbedding()) {
            try {
                if (this.embeddingProvider.generateEmbedding) {
                    embedding = await this.embeddingProvider.generateEmbedding(capsule.summary);
                }
            } catch (err) {
                console.warn('[MemoryStore] Failed to generate embedding for capsule, falling back to text only', err);
            }
        }

        // 先尝试带新列的完整 INSERT
        const emotion = capsule.emotion || 'none';
        const emotionWeight = capsule.emotionWeight ?? EMOTION_WEIGHTS[emotion];
        const isLocked = capsule.isLocked ? 1 : 0;
        const unlockAt = capsule.unlockAt || null;

        try {
            const args: any[] = [
                capsule.sessionId,
                capsule.summary,
                JSON.stringify(capsule.tags),
                capsule.category,
                emotion,
                emotionWeight,
                isLocked,
                unlockAt,
            ];
            const baseCols = `(session_id, summary, tags, category, emotion, emotion_weight, is_locked, unlock_at`;
            const baseVals = `(?, ?, ?, ?, ?, ?, ?, ?`;

            let sql: string;
            if (embedding && embedding.length > 0) {
                args.push(JSON.stringify(embedding));
                sql = `INSERT INTO capsules ${baseCols}, embedding) VALUES ${baseVals}, vector(?))`;
            } else {
                sql = `INSERT INTO capsules ${baseCols}) VALUES ${baseVals})`;
            }

            const result = await this.client.execute({ sql, args });
            return Number(result.lastInsertRowid);
        } catch (err: any) {
            // 若因 schema 版本落后（新列不存在）而失败，降级为旧 INSERT
            const msg = (err.message || '').toLowerCase();
            if (msg.includes('no such column') || msg.includes('has no column')) {
                console.warn('[MemoryStore] New columns not yet migrated, falling back to legacy insert.');
                return this.addCapsuleLegacy(capsule, embedding);
            }
            // 若因 vector 维度不匹配，去 vector 重试
            if (msg.includes('vector') || msg.includes('dimension')) {
                return this.addCapsuleLegacy(capsule, undefined);
            }
            throw err;
        }
    }

    /**
     * 降级插入：仅用基础列（向后兼容旧数据库 schema）。
     */
    private async addCapsuleLegacy(capsule: Capsule, embedding?: number[]): Promise<number> {
        const args: any[] = [
            capsule.sessionId,
            capsule.summary,
            JSON.stringify(capsule.tags),
            capsule.category,
        ];
        let sql: string;
        if (embedding && embedding.length > 0) {
            args.push(JSON.stringify(embedding));
            sql = `INSERT INTO capsules (session_id, summary, tags, category, embedding) VALUES (?, ?, ?, ?, vector(?))`;
        } else {
            sql = `INSERT INTO capsules (session_id, summary, tags, category) VALUES (?, ?, ?, ?)`;
        }
        const result = await this.client.execute({ sql, args });
        return Number(result.lastInsertRowid);
    }

    /**
     * 语义搜索：通过传入文本，计算其 Embedding，并在数据库中利用 vector_distance_cos 查找最相似的 Capsule。
     */
    public async searchCapsules(query: string, limit: number = 5): Promise<Capsule[]> {
        if (!this.embeddingProvider || !this.embeddingProvider.supportsEmbedding() || !this.embeddingProvider.generateEmbedding) {
            console.warn('[MemoryStore] Semantic search requested but no EmbeddingProvider available. Falling back to keyword search.');
            return this.searchCapsulesByKeyword(query, limit);
        }

        try {
            const embedding = await this.embeddingProvider.generateEmbedding(query);
            const embeddingStr = JSON.stringify(embedding);

            // Turso's libSQL gives us vector_distance_cos to rank by similarity.
            // ASC means lower distance (higher similarity).
            const sql = `
                SELECT 
                    id, session_id, summary, tags, category, embedding, created_at,
                    vector_distance_cos(embedding, vector(?)) as distance
                FROM capsules
                WHERE embedding IS NOT NULL
                ORDER BY distance ASC
                LIMIT ?
            `;

            const result = await this.client.execute({
                sql,
                args: [embeddingStr, limit]
            });

            return result.rows.map(row => this.rowToCapsule(row));
        } catch (err) {
            console.error('[MemoryStore] Turso/libSQL vector search failed, falling back to keyword search.', err);
            return this.searchCapsulesByKeyword(query, limit);
        }
    }

    /**
     * 基于关键词搜索胶囊（MVP 检索方式的回退方案）。
     */
    public async searchCapsulesByKeyword(query: string, limit: number = 10): Promise<Capsule[]> {
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

        if (tokens.length === 0) {
            return this.getRecentCapsules(limit);
        }

        const conditions = tokens.map(() => `(LOWER(summary) LIKE ? OR LOWER(tags) LIKE ?)`);
        const args = tokens.flatMap(t => [`%${t}%`, `%${t}%`]);

        const result = await this.client.execute({
            sql: `SELECT * FROM capsules WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
            args: [...args, limit],
        });

        return result.rows.map(row => this.rowToCapsule(row));
    }

    /**
     * 获取最近的胶囊（按时间倒排）。
     */
    public async getRecentCapsules(limit: number = 10): Promise<Capsule[]> {
        const result = await this.client.execute({
            sql: `SELECT * FROM capsules ORDER BY created_at DESC LIMIT ?`,
            args: [limit],
        });
        return result.rows.map(row => this.rowToCapsule(row));
    }

    /**
     * 按分类筛选胶囊。
     */
    public async getCapsulesByCategory(category: Capsule['category'], limit: number = 20): Promise<Capsule[]> {
        const result = await this.client.execute({
            sql: `SELECT * FROM capsules WHERE category = ? ORDER BY created_at DESC LIMIT ?`,
            args: [category, limit],
        });
        return result.rows.map(row => this.rowToCapsule(row));
    }

    // ═══════════════════════════════════════════
    // Preferences KV
    // ═══════════════════════════════════════════

    public async setPreference(key: string, value: string): Promise<void> {
        await this.client.execute({
            sql: `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, datetime('now'))
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
            args: [key, value],
        });
    }

    public async getPreference(key: string): Promise<string | null> {
        const result = await this.client.execute({
            sql: `SELECT value FROM preferences WHERE key = ?`,
            args: [key],
        });
        return result.rows.length > 0 ? String(result.rows[0].value) : null;
    }

    public async getAllPreferences(): Promise<Preference[]> {
        const result = await this.client.execute(`SELECT key, value FROM preferences ORDER BY key`);
        return result.rows.map(row => ({
            key: String(row.key),
            value: String(row.value),
        }));
    }

    // ═══════════════════════════════════════════
    // User Profile (Long-Term Memory)
    // ═══════════════════════════════════════════

    public async getUserProfile(): Promise<string | null> {
        return this.getPreference('user_profile_system_prompt');
    }

    public async updateUserProfile(content: string): Promise<void> {
        await this.setPreference('user_profile_system_prompt', content);
    }

    // ═══════════════════════════════════════════
    // Skills — 技能索引持久化
    // ═══════════════════════════════════════════

    /**
     * 全量同步技能列表到 DB（DELETE + INSERT 事务）。
     * 用于刷新后将最新的 SkillRegistry 数据持久化。
     */
    public async syncSkills(skills: Array<{
        name: string; description: string; keywords: string[];
        source: string; filePath: string;
    }>): Promise<void> {
        const stmts: string[] = [`DELETE FROM skills`];

        for (const s of skills) {
            const kw = JSON.stringify(s.keywords);
            // Escape single quotes for SQL
            const escapeSql = (v: string) => v.replace(/'/g, "''");
            stmts.push(
                `INSERT INTO skills (name, description, keywords, source, file_path, updated_at) ` +
                `VALUES ('${escapeSql(s.name)}', '${escapeSql(s.description)}', '${escapeSql(kw)}', ` +
                `'${escapeSql(s.source)}', '${escapeSql(s.filePath)}', datetime('now'))`
            );
        }

        await this.client.batch(stmts);
    }

    /**
     * 关键词搜索技能（LIKE 匹配 name / description / keywords）。
     */
    public async searchSkills(query: string, limit: number = 20): Promise<Array<{
        name: string; description: string; keywords: string[];
        source: string; filePath: string;
    }>> {
        const pattern = `%${query}%`;
        const result = await this.client.execute({
            sql: `SELECT name, description, keywords, source, file_path FROM skills
                  WHERE name LIKE ? OR description LIKE ? OR keywords LIKE ?
                  ORDER BY name LIMIT ?`,
            args: [pattern, pattern, pattern, limit],
        });
        return result.rows.map(this.rowToSkill);
    }

    /**
     * 获取全部已持久化的技能列表。
     */
    public async getAllSkills(): Promise<Array<{
        name: string; description: string; keywords: string[];
        source: string; filePath: string;
    }>> {
        const result = await this.client.execute(
            `SELECT name, description, keywords, source, file_path FROM skills ORDER BY source, name`
        );
        return result.rows.map(this.rowToSkill);
    }

    private rowToSkill(row: Record<string, unknown>): {
        name: string; description: string; keywords: string[];
        source: string; filePath: string;
    } {
        return {
            name: String(row.name),
            description: String(row.description || ''),
            keywords: JSON.parse(String(row.keywords || '[]')),
            source: String(row.source),
            filePath: String(row.file_path),
        };
    }

    // ═══════════════════════════════════════════
    // Internal Helpers
    // ═══════════════════════════════════════════

    private rowToCapsule(row: Record<string, unknown>): Capsule {
        // We do not return the full embedding array out of memory concerns unless explicitly needed,
        // usually we just need the metadata.
        return {
            id: Number(row.id),
            sessionId: String(row.session_id),
            summary: String(row.summary),
            tags: JSON.parse(String(row.tags || '[]')),
            category: String(row.category) as Capsule['category'],
            distance: row.distance !== undefined ? Number(row.distance) : undefined,
            createdAt: String(row.created_at),
            // ── 忆时增强字段 ──
            emotion: (String(row.emotion || 'none')) as EmotionLevel,
            emotionWeight: row.emotion_weight !== undefined ? Number(row.emotion_weight) : 0,
            recallCount: row.recall_count !== undefined ? Number(row.recall_count) : 0,
            lastRecalledAt: row.last_recalled_at ? String(row.last_recalled_at) : undefined,
            isLocked: row.is_locked === 1 || row.is_locked === true,
            unlockAt: row.unlock_at ? String(row.unlock_at) : undefined,
            // ── 多维度检索得分 ──
            combinedScore: row.combined_score !== undefined ? Number(row.combined_score) : undefined,
            semanticScore: row.semantic_score !== undefined ? Number(row.semantic_score) : undefined,
            recencyScore: row.recency_score !== undefined ? Number(row.recency_score) : undefined,
            frequencyScore: row.frequency_score !== undefined ? Number(row.frequency_score) : undefined,
        };
    }

    // ═══════════════════════════════════════════
    // 忆时：记忆关系图谱（联想扩散用）
    // ═══════════════════════════════════════════

    /**
     * 在两条记忆之间创建关联关系。
     */
    public async addRelationship(sourceId: number, targetId: number, type: MemoryRelationship['relationType'] = 'associative', strength: number = 0.5): Promise<number> {
        // 确保 source <= target 防止重复
        const [s, t] = sourceId <= targetId ? [sourceId, targetId] : [targetId, sourceId];
        const result = await this.client.execute({
            sql: `INSERT INTO memory_relationships (source_capsule_id, target_capsule_id, relation_type, strength)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(source_capsule_id, target_capsule_id) DO UPDATE SET strength = excluded.strength`,
            args: [s, t, type, strength],
        });
        return Number(result.lastInsertRowid);
    }

    /**
     * 获取指定记忆的所有关联关系（双向）。
     */
    public async getRelationships(capsuleId: number): Promise<MemoryRelationship[]> {
        const result = await this.client.execute({
            sql: `SELECT * FROM memory_relationships
                  WHERE source_capsule_id = ? OR target_capsule_id = ?
                  ORDER BY strength DESC`,
            args: [capsuleId, capsuleId],
        });
        return result.rows.map(row => ({
            id: Number(row.id),
            sourceCapsuleId: Number(row.source_capsule_id),
            targetCapsuleId: Number(row.target_capsule_id),
            relationType: String(row.relation_type) as MemoryRelationship['relationType'],
            strength: Number(row.strength),
            createdAt: String(row.created_at),
        }));
    }

    /**
     * 通过关联关系扩展检索：给定一组胶囊 ID，找到所有直接关联的胶囊。
     */
    public async expandViaRelationships(capsuleIds: number[], maxExpansion: number = 3): Promise<Capsule[]> {
        if (capsuleIds.length === 0) return [];
        const placeholders = capsuleIds.map(() => '?').join(',');
        const result = await this.client.execute({
            sql: `SELECT DISTINCT c.*, r.strength as rel_strength
                  FROM capsules c
                  JOIN memory_relationships r ON (
                      (r.source_capsule_id = c.id AND r.target_capsule_id IN (${placeholders}))
                      OR
                      (r.target_capsule_id = c.id AND r.source_capsule_id IN (${placeholders}))
                  )
                  WHERE c.id NOT IN (${placeholders})
                  ORDER BY r.strength DESC
                  LIMIT ?`,
            args: [...capsuleIds, ...capsuleIds, ...capsuleIds, maxExpansion],
        });
        return result.rows.map(row => this.rowToCapsule(row));
    }

    // ═══════════════════════════════════════════
    // 忆时：时间胶囊（封存 / 到期解锁）
    // ═══════════════════════════════════════════

    /**
     * 封存一条记忆（设为时间胶囊，到期自动解封）。
     */
    public async lockCapsule(capsuleId: number, unlockAt: string): Promise<void> {
        await this.client.execute({
            sql: `UPDATE capsules SET is_locked = 1, unlock_at = ? WHERE id = ?`,
            args: [unlockAt, capsuleId],
        });
    }

    /**
     * 手动解封一条记忆。
     */
    public async unlockCapsule(capsuleId: number): Promise<void> {
        await this.client.execute({
            sql: `UPDATE capsules SET is_locked = 0, unlock_at = NULL WHERE id = ?`,
            args: [capsuleId],
        });
    }

    /**
     * 检查所有已到期的封存胶囊，将其解封并返回。
     */
    public async checkExpiredCapsules(): Promise<Capsule[]> {
        const result = await this.client.execute({
            sql: `SELECT * FROM capsules
                  WHERE is_locked = 1 AND unlock_at IS NOT NULL AND unlock_at <= datetime('now')
                  ORDER BY unlock_at ASC`,
        });
        const expired = result.rows.map(row => this.rowToCapsule(row));
        // 批量解封
        if (expired.length > 0) {
            await this.client.execute(`UPDATE capsules SET is_locked = 0, unlock_at = NULL WHERE is_locked = 1 AND unlock_at IS NOT NULL AND unlock_at <= datetime('now')`);
        }
        return expired;
    }

    // ═══════════════════════════════════════════
    // 忆时：回忆计数追踪（频率强化因子）
    // ═══════════════════════════════════════════

    /**
     * 增加一条记忆的召回计数，更新最后回忆时间。
     */
    public async incrementRecallCount(capsuleId: number): Promise<void> {
        await this.client.execute({
            sql: `UPDATE capsules SET recall_count = recall_count + 1, last_recalled_at = datetime('now') WHERE id = ?`,
            args: [capsuleId],
        });
    }

    /**
     * 批量增加多条记忆的召回计数。
     */
    public async incrementRecallCounts(capsuleIds: number[]): Promise<void> {
        if (capsuleIds.length === 0) return;
        for (const id of capsuleIds) {
            await this.incrementRecallCount(id);
        }
    }

    // ═══════════════════════════════════════════
    // 忆时：遗忘曲线辅助（获取低频 / 久远记忆）
    // ═══════════════════════════════════════════

    /**
     * 获取低频旧记忆（适合遗忘归档处理）。
     */
    public async getLowFrequencyMemories(minDaysOld: number = 90, maxRecallCount: number = 2): Promise<Capsule[]> {
        const result = await this.client.execute({
            sql: `SELECT * FROM capsules
                  WHERE is_locked = 0
                    AND recall_count <= ?
                    AND created_at <= datetime('now', '-' || ? || ' days')
                  ORDER BY created_at ASC
                  LIMIT 50`,
            args: [maxRecallCount, minDaysOld],
        });
        return result.rows.map(row => this.rowToCapsule(row));
    }

    /**
     * 获取记忆统计信息。
     */
    public async getMemoryStats(): Promise<{
        total: number;
        locked: number;
        byEmotion: Record<string, number>;
        byCategory: Record<string, number>;
        avgRecallCount: number;
    }> {
        const total = await this.client.execute(`SELECT COUNT(*) as cnt FROM capsules`);
        const locked = await this.client.execute(`SELECT COUNT(*) as cnt FROM capsules WHERE is_locked = 1`);
        const byEmotion = await this.client.execute(`SELECT emotion, COUNT(*) as cnt FROM capsules GROUP BY emotion`);
        const byCategory = await this.client.execute(`SELECT category, COUNT(*) as cnt FROM capsules GROUP BY category`);
        const avgRecall = await this.client.execute(`SELECT AVG(recall_count) as avg FROM capsules`);

        const emotionMap: Record<string, number> = {};
        for (const row of byEmotion.rows) emotionMap[String(row.emotion)] = Number(row.cnt);
        const categoryMap: Record<string, number> = {};
        for (const row of byCategory.rows) categoryMap[String(row.category)] = Number(row.cnt);

        return {
            total: Number(total.rows[0]?.cnt || 0),
            locked: Number(locked.rows[0]?.cnt || 0),
            byEmotion: emotionMap,
            byCategory: categoryMap,
            avgRecallCount: Number(avgRecall.rows[0]?.avg || 0),
        };
    }
}

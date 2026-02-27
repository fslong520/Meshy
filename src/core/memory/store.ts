import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { ILLMProvider } from '../llm/provider.js';

// ─── 知识胶囊 ───
export interface Capsule {
    id?: number;
    sessionId: string;
    summary: string;
    tags: string[];
    category: 'success_pattern' | 'anti_pattern' | 'preference' | 'knowledge';
    embedding?: number[];
    createdAt?: string;
    distance?: number; // Used when returning semantic search results
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
     */
    public async initialize(): Promise<void> {
        await this.client.batch([
            `CREATE TABLE IF NOT EXISTS capsules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                summary TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                category TEXT NOT NULL DEFAULT 'knowledge',
                embedding FLOAT32(1536),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
            `CREATE TABLE IF NOT EXISTS preferences (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_category ON capsules(category)`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_session ON capsules(session_id)`,
            // Note: Creating a Vector Index `CREATE INDEX idx_embedding ON capsules (libsql_vector_idx(embedding));`
            // is optional for exact brute-force search if rows are small.
        ]);
    }

    // ═══════════════════════════════════════════
    // Capsule CRUD
    // ═══════════════════════════════════════════

    /**
     * 写入一条知识胶囊。如果有传入 embeddingProvider，自动为其生成 Embedding 并存储。
     */
    public async addCapsule(capsule: Capsule): Promise<number> {
        let embedding = capsule.embedding;

        // 如果没有传入向量，但配置了 Embedding Provider 且支持生成，自动生成
        if (!embedding && this.embeddingProvider && this.embeddingProvider.supportsEmbedding()) {
            try {
                if (this.embeddingProvider.generateEmbedding) {
                    embedding = await this.embeddingProvider.generateEmbedding(capsule.summary);
                }
            } catch (err) {
                console.warn('[MemoryStore] Failed to generate embedding for capsule, falling back to text only', err);
            }
        }

        const args: any[] = [
            capsule.sessionId,
            capsule.summary,
            JSON.stringify(capsule.tags),
            capsule.category,
        ];

        let sql = '';
        if (embedding && embedding.length > 0) {
            // libSQL expects vector(?) which will parse a JSON array of floats or a typed array buffer.
            // JSON stringification is the most standard bridge for JS to vector().
            args.push(JSON.stringify(embedding));
            sql = `INSERT INTO capsules (session_id, summary, tags, category, embedding) VALUES (?, ?, ?, ?, vector(?))`;
        } else {
            sql = `INSERT INTO capsules (session_id, summary, tags, category) VALUES (?, ?, ?, ?)`;
        }

        try {
            const result = await this.client.execute({ sql, args });
            return Number(result.lastInsertRowid);
        } catch (err: any) {
            if (sql.includes('vector(?)')) {
                console.warn('[MemoryStore] Failed to insert vector embedding (likely dimension mismatch), retrying without embedding. Error:', err.message);
                // Remove the last argument, which is the embedding payload
                args.pop();
                const fallbackSql = `INSERT INTO capsules (session_id, summary, tags, category) VALUES (?, ?, ?, ?)`;
                const result = await this.client.execute({ sql: fallbackSql, args });
                return Number(result.lastInsertRowid);
            }
            throw err;
        }
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
        };
    }
}

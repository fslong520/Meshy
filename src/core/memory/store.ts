/**
 * MemoryStore — 基于 libSQL (Turso) 的嵌入式项目记忆库
 *
 * 职责：
 * 1. 在 `.agent/memory.db` 中创建并维护 SQLite 数据库
 * 2. 存储知识胶囊 (Capsules)：每条胶囊包含 summary、tags、embedding 向量
 * 3. 存储用户偏好 (Preferences)：简单 KV 结构
 * 4. 提供基于关键词的检索（MVP），未来可升级为向量 Top-K 相似度检索
 *
 * 设计要点：
 * - 单文件部署，零外部依赖
 * - 所有写操作使用事务保证一致性
 * - 向量字段暂存为 JSON 序列化的 float[]，等 libSQL 原生 VSS 扩展就绪后无缝切换
 */

import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';

// ─── 知识胶囊 ───
export interface Capsule {
    id?: number;
    sessionId: string;
    summary: string;
    tags: string[];
    category: 'success_pattern' | 'anti_pattern' | 'preference' | 'knowledge';
    embedding?: number[];
    createdAt?: string;
}

// ─── 用户偏好 ───
export interface Preference {
    key: string;
    value: string;
}

export class MemoryStore {
    private client: Client;
    private dbPath: string;

    constructor(workspaceRoot: string = process.cwd()) {
        const agentDir = path.join(workspaceRoot, '.agent');
        if (!fs.existsSync(agentDir)) {
            fs.mkdirSync(agentDir, { recursive: true });
        }

        this.dbPath = path.join(agentDir, 'memory.db');
        this.client = createClient({
            url: `file:${this.dbPath}`,
        });
    }

    /**
     * 初始化数据库 schema。幂等操作，启动时调用。
     */
    public async initialize(): Promise<void> {
        await this.client.batch([
            `CREATE TABLE IF NOT EXISTS capsules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        category TEXT NOT NULL DEFAULT 'knowledge',
        embedding TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
            `CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_category ON capsules(category)`,
            `CREATE INDEX IF NOT EXISTS idx_capsules_session ON capsules(session_id)`,
        ]);
    }

    // ═══════════════════════════════════════════
    // Capsule CRUD
    // ═══════════════════════════════════════════

    /**
     * 写入一条知识胶囊。
     */
    public async addCapsule(capsule: Capsule): Promise<number> {
        const result = await this.client.execute({
            sql: `INSERT INTO capsules (session_id, summary, tags, category, embedding)
            VALUES (?, ?, ?, ?, ?)`,
            args: [
                capsule.sessionId,
                capsule.summary,
                JSON.stringify(capsule.tags),
                capsule.category,
                capsule.embedding ? JSON.stringify(capsule.embedding) : null,
            ],
        });

        return Number(result.lastInsertRowid);
    }

    /**
     * 基于关键词搜索胶囊（MVP 检索方式）。
     * 在 summary 和 tags 字段中做 LIKE 模糊匹配。
     */
    public async searchCapsules(query: string, limit: number = 10): Promise<Capsule[]> {
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

        if (tokens.length === 0) {
            return this.getRecentCapsules(limit);
        }

        // 构建 WHERE 子句：每个 token 都必须命中 summary 或 tags
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
    // Internal Helpers
    // ═══════════════════════════════════════════

    private rowToCapsule(row: Record<string, unknown>): Capsule {
        return {
            id: Number(row.id),
            sessionId: String(row.session_id),
            summary: String(row.summary),
            tags: JSON.parse(String(row.tags || '[]')),
            category: String(row.category) as Capsule['category'],
            embedding: row.embedding ? JSON.parse(String(row.embedding)) : undefined,
            createdAt: String(row.created_at),
        };
    }
}

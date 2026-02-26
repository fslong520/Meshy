/**
 * Ritual File System — Agent 可进化行为指令体系
 *
 * 从 `.meshy/rituals/` 加载 Ritual 文件：
 * - SOUL.md     — Agent 核心人格指令（不可变基础准则）
 * - HEARTBEAT.md — 心跳自省 Prompt（每 N 轮触发自我检查）
 * - BOOTSTRAP.md — 启动仪式 Prompt（会话开始时注入）
 *
 * 参考 OpenClaw 的 Ritual File Evolution 机制。
 */

import fs from 'fs';
import path from 'path';
import { getLogger } from '../logger/index.js';

// ─── Ritual 文件类型 ───
export type RitualType = 'soul' | 'heartbeat' | 'bootstrap';

// ─── Ritual 文件映射 ───
const RITUAL_FILES: Record<RitualType, string> = {
    soul: 'SOUL.md',
    heartbeat: 'HEARTBEAT.md',
    bootstrap: 'BOOTSTRAP.md',
};

export interface RitualContent {
    type: RitualType;
    content: string;
    filePath: string;
    lastModified: Date;
}

export class RitualLoader {
    private ritualsDir: string;
    private cache: Map<RitualType, RitualContent> = new Map();

    constructor(workspaceRoot: string = process.cwd()) {
        this.ritualsDir = path.join(workspaceRoot, '.meshy', 'rituals');
    }

    /** 加载所有 Ritual 文件到缓存 */
    public load(): void {
        if (!fs.existsSync(this.ritualsDir)) return;

        const logger = getLogger();

        for (const [type, filename] of Object.entries(RITUAL_FILES)) {
            const filePath = path.join(this.ritualsDir, filename);
            if (!fs.existsSync(filePath)) continue;

            try {
                const content = fs.readFileSync(filePath, 'utf8').trim();
                const stat = fs.statSync(filePath);

                this.cache.set(type as RitualType, {
                    type: type as RitualType,
                    content,
                    filePath,
                    lastModified: stat.mtime,
                });

                logger.debug('ENGINE', `Loaded ritual: ${filename} (${content.length} chars)`);
            } catch {
                // 静默跳过不可读的文件
            }
        }
    }

    /** 获取特定 Ritual 的内容 */
    public get(type: RitualType): string | null {
        return this.cache.get(type)?.content ?? null;
    }

    /** 获取所有已加载的 Ritual */
    public getAll(): RitualContent[] {
        return Array.from(this.cache.values());
    }

    /** 检测文件变化并热重载 */
    public reload(): void {
        this.cache.clear();
        this.load();
    }

    /**
     * 构建要注入到 System Prompt 的 Ritual 上下文块。
     * Soul 永远注入，Bootstrap 仅在会话首轮注入。
     */
    public buildPromptInjection(isFirstTurn: boolean): string {
        const parts: string[] = [];

        const soul = this.get('soul');
        if (soul) {
            parts.push(`<ritual type="soul">\n${soul}\n</ritual>`);
        }

        if (isFirstTurn) {
            const bootstrap = this.get('bootstrap');
            if (bootstrap) {
                parts.push(`<ritual type="bootstrap">\n${bootstrap}\n</ritual>`);
            }
        }

        return parts.join('\n\n');
    }

    /**
     * 获取心跳自省 Prompt（用于 HeartbeatScheduler 定期触发）
     */
    public getHeartbeatPrompt(): string | null {
        return this.get('heartbeat');
    }
}

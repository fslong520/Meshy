import fs from 'fs';
import path from 'path';
import { Session } from './state.js';

/**
 * SnapshotManager — 会话定点打卡与崩溃恢复管理器
 * 
 * 职责：
 * 1. 每次工具调用或大模型回复后，将 Session 序列化并存入 `.agent/sessions/<SessionID>.json`
 * 2. 维护一个 `latest.txt` 指向最后一个活跃的 Session
 * 3. 启动时检查是否有未正常结束的会话，并支持读回内存
 */
export class SnapshotManager {
    private sessionsDir: string;
    private latestFile: string;

    constructor(workspaceRoot: string = process.cwd()) {
        const agentDir = path.join(workspaceRoot, '.meshy');
        this.sessionsDir = path.join(agentDir, 'sessions');
        this.latestFile = path.join(this.sessionsDir, 'latest.txt');

        // Ensure directories exist
        if (!fs.existsSync(agentDir)) {
            fs.mkdirSync(agentDir, { recursive: true });
        }
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    /**
     * 将当前会话序列化并落盘保存
     */
    public snapshot(session: Session): void {
        try {
            const data = session.serialize();
            const filePath = path.join(this.sessionsDir, `${session.id}.json`);

            // 写入会话数据
            fs.writeFileSync(filePath, data, 'utf-8');

            // 更新 latest 指针
            fs.writeFileSync(this.latestFile, session.id, 'utf-8');
        } catch (err) {
            console.error('[SnapshotManager] Failed to snapshot session:', err);
        }
    }

    /**
     * 加载最新一次中断的会话
     * 如果没有记录或文件已损坏/被删，则返回 null
     */
    public loadLatestSession(): Session | null {
        try {
            if (!fs.existsSync(this.latestFile)) {
                return null;
            }

            const latestId = fs.readFileSync(this.latestFile, 'utf-8').trim();
            if (!latestId) return null;

            const filePath = path.join(this.sessionsDir, `${latestId}.json`);
            if (!fs.existsSync(filePath)) {
                return null;
            }

            const data = fs.readFileSync(filePath, 'utf-8');
            return Session.deserialize(data);
        } catch (err) {
            console.error('[SnapshotManager] Failed to load latest session:', err);
            return null;
        }
    }

    /**
     * 清理（删除）指定的会话快照
     * @param sessionId 可选，若不传则尝试清理 latest
     */
    public clearSnapshot(sessionId?: string): void {
        try {
            let idToRemove = sessionId;
            if (!idToRemove && fs.existsSync(this.latestFile)) {
                idToRemove = fs.readFileSync(this.latestFile, 'utf-8').trim();
            }

            if (idToRemove) {
                const filePath = path.join(this.sessionsDir, `${idToRemove}.json`);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            // 如果清理的正好是 latest，则移除 latest 指针
            if (fs.existsSync(this.latestFile)) {
                const currentLatest = fs.readFileSync(this.latestFile, 'utf-8').trim();
                if (currentLatest === idToRemove) {
                    fs.unlinkSync(this.latestFile);
                }
            }
        } catch (err) {
            console.error('[SnapshotManager] Failed to clear snapshot:', err);
        }
    }
}

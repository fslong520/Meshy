/**
 * SessionManager — Full Session Lifecycle Controller
 *
 * Provides operations to list, suspend, resume, and archive sessions.
 * Works on top of the existing SnapshotManager file system.
 */

import fs from 'fs';
import path from 'path';
import { Session, SessionStatus } from './state.js';
import { SnapshotManager } from './snapshot.js';
import { ReflectionEngine } from '../memory/reflection.js';

export interface SessionSummary {
    id: string;
    status: SessionStatus;
    createdAt: string;
    updatedAt: string;
    goal: string;
    title?: string;
    messageCount: number;
}

export class SessionManager {
    private snapshotManager: SnapshotManager;
    private sessionsDir: string;
    private reflectionEngine: ReflectionEngine | null;

    constructor(
        workspaceRoot: string,
        snapshotManager?: SnapshotManager,
        reflectionEngine?: ReflectionEngine,
    ) {
        this.snapshotManager = snapshotManager ?? new SnapshotManager(workspaceRoot);
        this.reflectionEngine = reflectionEngine ?? null;
        this.sessionsDir = path.join(workspaceRoot, '.meshy', 'sessions');
    }

    /**
     * List all persisted sessions with lightweight metadata (no full history).
     */
    public listSessions(): SessionSummary[] {
        const summaries: SessionSummary[] = [];

        if (!fs.existsSync(this.sessionsDir)) {
            return summaries;
        }

        const files = fs.readdirSync(this.sessionsDir)
            .filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));

        for (const file of files) {
            try {
                const filePath = path.join(this.sessionsDir, file);

                // Read up to 64KB to snag the first line (metadata) efficiently
                const fd = fs.openSync(filePath, 'r');
                const buffer = Buffer.alloc(65536);
                const bytesRead = fs.readSync(fd, buffer, 0, 65536, 0);
                fs.closeSync(fd);

                const content = buffer.toString('utf-8', 0, bytesRead);
                const firstLine = content.split('\n')[0];
                const parsed = JSON.parse(firstLine || '{}');

                summaries.push({
                    id: parsed.id || file.replace(/\.jsonl?$/, ''),
                    status: parsed.status || 'active',
                    createdAt: parsed.createdAt || 'unknown',
                    updatedAt: parsed.updatedAt || 'unknown',
                    goal: parsed.blackboard?.currentGoal || '(no goal)',
                    title: parsed.title || '',
                    messageCount: parsed.history?.length || 0, // In .jsonl, this will be 0 on summary, but that's fine
                });
            } catch {
                // Skip corrupted files silently
            }
        }

        // Sort by updatedAt descending (most recently active first)
        summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return summaries;
    }

    /**
     * Create a fresh new session.
     */
    public createSession(): Session {
        const session = new Session(`session-${Date.now()}`);
        return session;
    }

    /**
     * Load a specific session by ID (alias for resumeSession for backward compat).
     */
    public loadSession(sessionId: string): Session | null {
        return this.resumeSession(sessionId);
    }

    /**
     * Save the given session (alias for snapshotManager.snapshot).
     */
    public saveSession(session: Session): void {
        this.snapshotManager.snapshot(session);
    }

    /**
     * Suspend the current active session (persist to disk and mark suspended).
     */
    public suspendSession(session: Session): void {
        session.status = 'suspended';
        session.updatedAt = new Date().toISOString();
        this.snapshotManager.snapshot(session);
        console.log(`[SessionManager] Session "${session.id}" suspended.`);
    }

    /**
     * Resume a previously suspended session by ID.
     */
    public resumeSession(sessionId: string): Session | null {
        let filePath = path.join(this.sessionsDir, `${sessionId}.jsonl`);
        if (!fs.existsSync(filePath)) {
            filePath = path.join(this.sessionsDir, `${sessionId}.json`);
            if (!fs.existsSync(filePath)) {
                console.warn(`[SessionManager] Session "${sessionId}" not found.`);
                return null;
            }
        }

        try {
            const data = fs.readFileSync(filePath, 'utf-8');
            const session = Session.deserialize(data);
            session.status = 'active';
            session.updatedAt = new Date().toISOString();
            // Re-snapshot with active status
            this.snapshotManager.snapshot(session);
            console.log(`[SessionManager] Session "${session.id}" resumed.`);
            return session;
        } catch (err) {
            console.error(`[SessionManager] Failed to resume session "${sessionId}":`, err);
            return null;
        }
    }

    /**
     * Archive a session: mark as archived and trigger ReflectionEngine for experience extraction.
     */
    public async archiveSession(session: Session): Promise<void> {
        session.status = 'archived';
        session.updatedAt = new Date().toISOString();
        this.snapshotManager.snapshot(session);

        console.log(`[SessionManager] Session "${session.id}" archived. Triggering reflection...`);

        // Auto-trigger experience extraction (fire-and-forget, errors don't block)
        if (!this.reflectionEngine) {
            console.log(`[SessionManager] No ReflectionEngine configured, skipping reflection.`);
            return;
        }

        try {
            const result = await this.reflectionEngine.onSessionComplete({ session });
            if (result) {
                console.log(`[SessionManager] Reflection capsule extracted: "${result.summary}" (tags: ${result.tags.join(', ')})`);
            } else {
                console.log(`[SessionManager] No reflection capsule generated for this session.`);
            }
        } catch (err) {
            console.warn(`[SessionManager] Reflection failed (non-critical):`, err);
        }
    }

    /**
     * Delete a session and its associated files.
     */
    public async deleteSession(sessionId: string, memoryStore?: any): Promise<void> {
        const jsonlPath = path.join(this.sessionsDir, `${sessionId}.jsonl`);
        const jsonPath = path.join(this.sessionsDir, `${sessionId}.json`);

        if (fs.existsSync(jsonlPath)) {
            await fs.promises.unlink(jsonlPath);
        } else if (fs.existsSync(jsonPath)) {
            await fs.promises.unlink(jsonPath);
        } else {
            throw new Error(`Session ${sessionId} not found`);
        }

        if (memoryStore) {
            try {
                // Delete from DB if supported (future proofing)
                const sql = `DELETE FROM capsules WHERE session_id = ?`;
                await memoryStore.client?.execute({ sql, args: [sessionId] });
            } catch (err) {
                console.warn(`[SessionManager] Failed to delete session ${sessionId} from DB:`, err);
            }
        }
        console.log(`[SessionManager] Session "${sessionId}" deleted.`);
    }

    /**
     * Rename a session's title.
     */
    public renameSession(sessionId: string, newTitle: string): Session {
        const session = this.resumeSession(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found for renaming`);
        }
        session.title = newTitle;
        session.updatedAt = new Date().toISOString();
        this.snapshotManager.snapshot(session);
        console.log(`[SessionManager] Session "${sessionId}" renamed to "${newTitle}".`);
        return session;
    }

    /**
     * Compact a session's history to save tokens.
     */
    public compactSession(sessionId: string): Session {
        const session = this.resumeSession(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found for compacting`);
        }

        // Advanced compaction logic: Keep system prompt, first user message, and last N messages
        if (session.history.length > 5) {
            const systemMessages = session.history.filter(m => m.role === 'system');
            const userMessages = session.history.filter(m => m.role === 'user');
            const firstUserMessage = userMessages.length > 0 ? userMessages[0] : null;

            // Keep the last 4 messages (which could be user/assistant/tool)
            const recentMessages = session.history.slice(-4);

            // Reconstruct timeline
            const compacted = [...systemMessages];
            if (firstUserMessage && !recentMessages.includes(firstUserMessage)) {
                compacted.push(firstUserMessage);
                // Add a summary message to indicate compaction
                compacted.push({
                    role: 'assistant',
                    content: '[System Note: Previous conversation history has been compacted to save context window]'
                });
            }

            // Add recent messages, avoiding duplicates if they overlap with system/first messages
            for (const msg of recentMessages) {
                // simple deduplication based on object ref
                if (!compacted.includes(msg)) {
                    compacted.push(msg);
                }
            }

            session.history = compacted;
            session.updatedAt = new Date().toISOString();
            this.snapshotManager.snapshot(session);
            console.log(`[SessionManager] Session "${sessionId}" compacted. Messages reduced to ${session.history.length}.`);
        } else {
            console.log(`[SessionManager] Session "${sessionId}" is already small enough (${session.history.length} msgs). Compaction skipped.`);
        }

        return session;
    }
}

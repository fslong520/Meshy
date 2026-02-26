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
            .filter(f => f.endsWith('.json'));

        for (const file of files) {
            try {
                const filePath = path.join(this.sessionsDir, file);
                const raw = fs.readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(raw);

                summaries.push({
                    id: parsed.id || file.replace('.json', ''),
                    status: parsed.status || 'active',
                    createdAt: parsed.createdAt || 'unknown',
                    updatedAt: parsed.updatedAt || 'unknown',
                    goal: parsed.blackboard?.currentGoal || '(no goal)',
                    messageCount: parsed.history?.length || 0,
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
        this.snapshotManager.snapshot(session);
        return session;
    }

    /**
     * Load a specific session by ID (alias for resumeSession for backward compat).
     */
    public loadSession(sessionId: string): Session | null {
        return this.resumeSession(sessionId);
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
        const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
        if (!fs.existsSync(filePath)) {
            console.warn(`[SessionManager] Session "${sessionId}" not found.`);
            return null;
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
}

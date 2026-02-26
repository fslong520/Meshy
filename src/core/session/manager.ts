import { Session } from './state.js';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export class SessionManager {
    private sessionsDir: string;

    constructor(workspaceRoot: string) {
        this.sessionsDir = path.join(workspaceRoot, '.meshy', 'sessions');
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    public createSession(): Session {
        const id = uuidv4();
        const session = new Session(id);
        this.saveSession(session);
        return session;
    }

    public saveSession(session: Session) {
        const filePath = path.join(this.sessionsDir, `${session.id}.json`);
        const data = session.serialize();
        fs.writeFileSync(filePath, data, 'utf8');
    }

    public loadSession(id: string): Session | undefined {
        const filePath = path.join(this.sessionsDir, `${id}.json`);
        if (!fs.existsSync(filePath)) return undefined;

        try {
            const data = fs.readFileSync(filePath, 'utf8');
            return Session.deserialize(data);
        } catch (e) {
            console.error(`[SessionManager] Failed to load session ${id}:`, e);
            return undefined;
        }
    }

    public listSessions(): Array<{ id: string; lastModified: Date }> {
        if (!fs.existsSync(this.sessionsDir)) return [];
        const files = fs.readdirSync(this.sessionsDir);
        return files
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const id = f.replace('.json', '');
                const stats = fs.statSync(path.join(this.sessionsDir, f));
                return { id, lastModified: stats.mtime };
            })
            .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    }

    public deleteSession(id: string) {
        const filePath = path.join(this.sessionsDir, `${id}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

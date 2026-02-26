import * as fs from 'fs';
import * as path from 'path';

export interface BlackboardState {
    [key: string]: any;
}

/**
 * Shared Blackboard for Agent Collaboration
 * 
 * Provides a highly isolated JSON store (.meshy/blackboard.json) where
 * Orchestrator and Worker agents can leave messages and state.
 * This removes the need to pass complete conversation logs between agents.
 */
export class CollaborativeBlackboard {
    private filePath: string;
    private state: BlackboardState = {};

    constructor(workspaceRoot: string) {
        this.filePath = path.join(workspaceRoot, '.meshy', 'blackboard.json');
        this.load();
    }

    private load(): void {
        if (fs.existsSync(this.filePath)) {
            try {
                const content = fs.readFileSync(this.filePath, 'utf-8');
                this.state = JSON.parse(content);
            } catch (err) {
                console.warn('[Blackboard] Failed to parse blackboard file, resetting to empty.', err);
                this.state = {};
            }
        } else {
            this.state = {};
            this.save();
        }
    }

    private save(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
        } catch (err) {
            console.error('[Blackboard] Failed to save state to disk.', err);
        }
    }

    /**
     * Read a specific key from the blackboard, or the entire board if no key is provided.
     */
    public read(key?: string): any {
        this.load(); // Refresh from disk in case another process modified it
        if (key) {
            return this.state[key] !== undefined ? this.state[key] : null;
        }
        return this.state;
    }

    /**
     * Write or update a specific key on the blackboard.
     */
    public write(key: string, value: any): void {
        this.load();
        this.state[key] = value;
        this.save();
    }

    /**
     * Delete a specific key from the blackboard.
     */
    public delete(key: string): void {
        this.load();
        if (key in this.state) {
            delete this.state[key];
            this.save();
        }
    }

    /**
     * Clear the entire blackboard.
     */
    public clear(): void {
        this.state = {};
        this.save();
    }
}

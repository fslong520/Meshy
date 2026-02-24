import { StandardMessage } from '../llm/provider.js';

export interface BlockboardState {
    currentGoal: string;
    tasks: Array<{
        id: string;
        description: string;
        status: 'pending' | 'in_progress' | 'completed' | 'failed';
    }>;
    openFiles: string[];
    lastError: string | null;
}

export class Session {
    public id: string;
    public history: StandardMessage[];
    public blackboard: BlockboardState;
    /** Current active lazy tools bound to this session */
    public activatedTools: Set<string>;

    constructor(id: string) {
        this.id = id;
        this.history = [];
        this.blackboard = {
            currentGoal: '',
            tasks: [],
            openFiles: [],
            lastError: null,
        };
        this.activatedTools = new Set();
    }

    public addMessage(message: StandardMessage) {
        this.history.push(message);
    }

    public updateBlackboard(updates: Partial<BlockboardState>) {
        this.blackboard = { ...this.blackboard, ...updates };
    }

    public activateTool(toolId: string) {
        this.activatedTools.add(toolId);
    }

    public clearActivatedTools() {
        this.activatedTools.clear();
    }

    /**
     * Compresses or truncates history if it gets too long.
     * A true implementation would summarize older events or use RAG.
     */
    public compressHistory(): void {
        if (this.history.length > 50) {
            // Keep the system prompt + recent 20 messages to save context limit
            const systemPrompts = this.history.filter(m => m.role === 'system');
            const recent = this.history.slice(-20);
            this.history = [...systemPrompts, ...recent];
        }
    }

    public serialize(): string {
        // In L1 Infrastructure, this would serialize into a highly compressed 
        // binary format like MessagePack or Protobuf. For MVP, we use JSON.
        return JSON.stringify({
            id: this.id,
            history: this.history,
            blackboard: this.blackboard,
        });
    }

    public static deserialize(data: string): Session {
        const parsed = JSON.parse(data);
        const session = new Session(parsed.id);
        session.history = parsed.history || [];
        session.blackboard = parsed.blackboard;
        return session;
    }
}

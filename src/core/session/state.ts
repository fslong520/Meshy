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

    /** LLM/用户显式 pin 的工具（跨轮持久） */
    public pinnedTools: Set<string>;
    /** ToolRAG 每轮动态检索的工具（每轮刷新） */
    public ragSelectedTools: Set<string>;

    /** 兼容属性：返回 pinned + ragSelected 的合集 */
    public get activatedTools(): Set<string> {
        return new Set([...this.pinnedTools, ...this.ragSelectedTools]);
    }

    constructor(id: string) {
        this.id = id;
        this.history = [];
        this.blackboard = {
            currentGoal: '',
            tasks: [],
            openFiles: [],
            lastError: null,
        };
        this.pinnedTools = new Set();
        this.ragSelectedTools = new Set();
    }

    public addMessage(message: StandardMessage) {
        this.history.push(message);
    }

    public updateBlackboard(updates: Partial<BlockboardState>) {
        this.blackboard = { ...this.blackboard, ...updates };
    }

    // ─── Pinned Tools（持久，跨轮） ───

    public pinTool(toolId: string) {
        this.pinnedTools.add(toolId);
    }

    public unpinTool(toolId: string) {
        this.pinnedTools.delete(toolId);
    }

    // ─── RAG Selected Tools（每轮刷新） ───

    public setRagTools(toolIds: string[]) {
        this.ragSelectedTools.clear();
        for (const id of toolIds) {
            this.ragSelectedTools.add(id);
        }
    }

    // ─── 兼容旧接口 ───

    public activateTool(toolId: string) {
        this.pinnedTools.add(toolId);
    }

    public deactivateTool(toolId: string) {
        this.pinnedTools.delete(toolId);
        this.ragSelectedTools.delete(toolId);
    }

    public touchTool(_toolId: string) {
        // No-op in new architecture; pinned tools persist, RAG tools are per-turn
    }

    public clearActivatedTools() {
        this.pinnedTools.clear();
        this.ragSelectedTools.clear();
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

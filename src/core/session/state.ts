import { StandardMessage } from '../llm/provider.js';
import type { RuntimeTaskStatus } from '../runtime/protocol.js';
import type { ToolPolicyMode } from '../tool/registry.js';

export type SessionStatus = 'active' | 'suspended' | 'archived';

export interface BlackboardTask {
    id: string;
    description: string;
    status: RuntimeTaskStatus;
}

export interface BlockboardState {
    currentGoal: string;
    tasks: BlackboardTask[];
    openFiles: string[];
    lastError: string | null;
}

export interface BackgroundProcessState {
    id: string;
    command: string;
    cwd: string;
    startedAt: string;
}

export interface RuntimeDecisionRecord {
    loopIndex: number;
    injectedSkills: string[];
    activeMcpServers: string[];
    reasonSummary?: string;
}

export interface ToolPolicyHistoryEntry {
    previousMode: ToolPolicyMode;
    nextMode: ToolPolicyMode;
    changedAt: string;
    source: string;
}

export class Session {
    public id: string;
    public title?: string;
    public history: StandardMessage[];
    public blackboard: BlockboardState;
    public createdAt: string;
    public updatedAt: string;
    public status: SessionStatus;
    public activeAgentId: string;
    public backgroundProcesses: BackgroundProcessState[];
    public runtimeDecisions: RuntimeDecisionRecord[];
    public toolPolicyMode: ToolPolicyMode;
    public toolPolicyHistory: ToolPolicyHistoryEntry[];

    /** LLM/用户显式 pin 的工具（跨轮持久） */
    public pinnedTools: Set<string>;
    /** ToolRAG 每轮动态检索的工具（每轮刷新） */
    public ragSelectedTools: Set<string>;
    /** 已显式加载全部 Schema 的 MCP Servers */
    public activatedMcpServers: Set<string>;

    /** 兼容属性：返回 pinned + ragSelected 的合集 */
    public get activatedTools(): Set<string> {
        return new Set([...Array.from(this.pinnedTools), ...Array.from(this.ragSelectedTools)]);
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
        this.activatedMcpServers = new Set();
        const now = new Date().toISOString();
        this.createdAt = now;
        this.updatedAt = now;
        this.status = 'active';
        this.activeAgentId = 'default';
        this.backgroundProcesses = [];
        this.runtimeDecisions = [];
        this.toolPolicyMode = 'standard';
        this.toolPolicyHistory = [];
    }

    public touch() {
        this.updatedAt = new Date().toISOString();
    }

    public addMessage(message: StandardMessage) {
        this.history.push(message);
        this.touch();
    }

    public appendRuntimeDecision(record: RuntimeDecisionRecord): void {
        this.runtimeDecisions.push(record);
        this.touch();
    }

    public updateBlackboard(updates: Partial<BlockboardState>) {
        this.blackboard = { ...this.blackboard, ...updates };
        this.touch();
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

    /** 清空整个 Session（历史、黑板、工具挂载全部重置） */
    public clear(): void {
        this.history = [];
        this.blackboard = { currentGoal: '', tasks: [], openFiles: [], lastError: null };
        this.clearActivatedTools();
    }

    /**
     * @deprecated All compression is now handled by CompactionAgent (compaction.ts).
     * This method is kept as a no-op for backward compatibility.
     */
    public compressHistory(): void {
        // No-op: Compression is now handled exclusively by CompactionAgent
        // to ensure a proper LLM-summarized compaction instead of brute-force truncation.
    }

    public serialize(): string {
        const baseState = {
            id: this.id,
            title: this.title,
            blackboard: this.blackboard,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            status: this.status,
            activeAgentId: this.activeAgentId,
            messageCount: this.history.length,
            pinnedTools: Array.from(this.pinnedTools),
            ragSelectedTools: Array.from(this.ragSelectedTools),
            activatedMcpServers: Array.from(this.activatedMcpServers),
            backgroundProcesses: this.backgroundProcesses,
            toolPolicyMode: this.toolPolicyMode,
            toolPolicyHistory: this.toolPolicyHistory,
        };

        let result = JSON.stringify(baseState) + '\n';
        for (const msg of this.history) {
            result += JSON.stringify({ type: 'message', message: msg }) + '\n';
        }
        return result;
    }

    public static deserialize(data: string): Session {
        const lines = data.split('\n').filter(l => l.trim().length > 0);
        let parsedMeta: any = {};

        try {
            // First line or whole json
            parsedMeta = JSON.parse(lines[0] || '{}');

            // Backwards compatibility with standard JSON
            if (lines.length === 1 && parsedMeta.history !== undefined) {
                const session = new Session(parsedMeta.id);
                if (parsedMeta.title) session.title = parsedMeta.title;
                session.history = parsedMeta.history || [];
                session.blackboard = parsedMeta.blackboard || { currentGoal: '', tasks: [], openFiles: [], lastError: null };
                session.activeAgentId = parsedMeta.activeAgentId || 'default';
                session.backgroundProcesses = parsedMeta.backgroundProcesses || [];
                if (Array.isArray(parsedMeta.pinnedTools)) {
                    session.pinnedTools = new Set(parsedMeta.pinnedTools);
                }
                if (Array.isArray(parsedMeta.ragSelectedTools)) {
                    session.ragSelectedTools = new Set(parsedMeta.ragSelectedTools);
                }
                if (parsedMeta.createdAt) session.createdAt = parsedMeta.createdAt;
                if (parsedMeta.updatedAt) session.updatedAt = parsedMeta.updatedAt;
                if (parsedMeta.status) session.status = parsedMeta.status;
                if (parsedMeta.activatedMcpServers) {
                    session.activatedMcpServers = new Set(parsedMeta.activatedMcpServers);
                }
                if (parsedMeta.toolPolicyMode === 'read_only' || parsedMeta.toolPolicyMode === 'standard') {
                    session.toolPolicyMode = parsedMeta.toolPolicyMode;
                }
                if (Array.isArray(parsedMeta.toolPolicyHistory)) {
                    session.toolPolicyHistory = parsedMeta.toolPolicyHistory;
                }
                return session;
            }
        } catch (e) {
            console.warn('[Session] Failed to parse meta line', e);
        }

        const session = new Session(parsedMeta.id || `session-${Date.now()}`);
        if (parsedMeta.title) session.title = parsedMeta.title;
        session.blackboard = parsedMeta.blackboard || { currentGoal: '', tasks: [], openFiles: [], lastError: null };
        session.activeAgentId = parsedMeta.activeAgentId || 'default';
        session.backgroundProcesses = parsedMeta.backgroundProcesses || [];
        if (Array.isArray(parsedMeta.pinnedTools)) {
            session.pinnedTools = new Set(parsedMeta.pinnedTools);
        }
        if (Array.isArray(parsedMeta.ragSelectedTools)) {
            session.ragSelectedTools = new Set(parsedMeta.ragSelectedTools);
        }
        if (parsedMeta.createdAt) session.createdAt = parsedMeta.createdAt;
        if (parsedMeta.updatedAt) session.updatedAt = parsedMeta.updatedAt;
        if (parsedMeta.status) session.status = parsedMeta.status;
        if (parsedMeta.activatedMcpServers) {
            session.activatedMcpServers = new Set(parsedMeta.activatedMcpServers);
        }
        if (parsedMeta.toolPolicyMode === 'read_only' || parsedMeta.toolPolicyMode === 'standard') {
            session.toolPolicyMode = parsedMeta.toolPolicyMode;
        }
        if (Array.isArray(parsedMeta.toolPolicyHistory)) {
            session.toolPolicyHistory = parsedMeta.toolPolicyHistory;
        }

        // Replay events
        for (let i = 1; i < lines.length; i++) {
            try {
                const row = JSON.parse(lines[i]);
                if (row.type === 'message' && row.message) {
                    session.history.push(row.message);
                } else if (row.type === 'state_update') {
                    if (row.blackboard) session.blackboard = row.blackboard;
                    if (row.status) session.status = row.status;
                    if (row.updatedAt) session.updatedAt = row.updatedAt;
                    if (row.title) session.title = row.title;
                }
            } catch (e) {
                // skip corrupted lines
            }
        }

        return session;
    }
}

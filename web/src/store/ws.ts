import { useEffect, useRef, useCallback, useState } from 'react';

// ─── RPC 消息协议（与后端 DaemonServer 一致）───

export interface RpcMessage {
    id?: string;
    type: 'request' | 'response' | 'event';
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    name?: string;
    data?: unknown;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'agent';
    content: string;
    timestamp: number;
    reasoningContent?: string;
    toolCalls?: ToolCallInfo[];
    approval?: ApprovalInfo;
    attachments?: { name: string; type: string; data: string }[];
}

export interface ToolCallInfo {
    id: string;
    name: string;
    args: string;
    result?: string;
    status: 'running' | 'done' | 'error';
    approvalReason?: string;
    policyDecision?: {
        decision: 'allow' | 'deny';
        mode: string;
        permissionClass: string;
        reason: string;
    };
}

export interface ApprovalInfo {
    id: string;
    question: string;
    context?: string;
    resolved: boolean;
}

export interface PolicyDecisionEvent {
    id: string;
    tool: string;
    decision: 'allow' | 'deny';
    mode: string;
    permissionClass: string;
    reason: string;
    timestamp: number;
}

type EventHandler = (msg: RpcMessage) => void;

// ─── 模块级状态 ───
let callIdCounter = 1;
const eventHandlers = new Map<string, Set<EventHandler>>();
let sseSource: EventSource | null = null;
let sseConnected = false;
let policyDecisionBridgeAttached = false;
let policyDecisionBridgeUnsub: (() => void) | null = null;
const policyDecisionTimeline: PolicyDecisionEvent[] = [];
const POLICY_TIMELINE_LIMIT = 200;

// ─── HMR 安全措施：Vite 热替换时清空所有旧 handler ───
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        // 模块被替换前，清空所有 handler 防止幽灵回调
        eventHandlers.clear();
        if (sseSource) {
            sseSource.close();
            sseSource = null;
        }
        policyDecisionBridgeUnsub?.();
        policyDecisionBridgeUnsub = null;
        policyDecisionBridgeAttached = false;
        policyDecisionTimeline.length = 0;
    });
}

function parsePolicyDecisionPayload(msg: RpcMessage): PolicyDecisionEvent | null {
    if (msg.type !== 'event' || msg.name !== 'agent:policy_decision') return null;
    const data = msg.data as Record<string, unknown> | undefined;
    if (!data) return null;

    const id = typeof data.id === 'string' ? data.id : '';
    const tool = typeof data.tool === 'string' ? data.tool : '';
    const decision = data.decision === 'allow' || data.decision === 'deny' ? data.decision : null;
    const mode = typeof data.mode === 'string' ? data.mode : '';
    const permissionClass = typeof data.permissionClass === 'string' ? data.permissionClass : '';
    const reason = typeof data.reason === 'string' ? data.reason : '';
    const parsedTimestamp = typeof data.timestamp === 'string' ? Date.parse(data.timestamp) : NaN;
    if (!id || !tool || !decision || !mode || !permissionClass || !reason) return null;

    return {
        id,
        tool,
        decision,
        mode,
        permissionClass,
        reason,
        timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(),
    };
}

export function ingestPolicyDecisionEvent(msg: RpcMessage): PolicyDecisionEvent | null {
    const parsed = parsePolicyDecisionPayload(msg);
    if (!parsed) return null;

    policyDecisionTimeline.push(parsed);
    if (policyDecisionTimeline.length > POLICY_TIMELINE_LIMIT) {
        policyDecisionTimeline.splice(0, policyDecisionTimeline.length - POLICY_TIMELINE_LIMIT);
    }
    return parsed;
}

export function getPolicyDecisionTimeline(): PolicyDecisionEvent[] {
    return policyDecisionTimeline.map((item) => ({ ...item }));
}

export function replacePolicyDecisionTimeline(events: PolicyDecisionEvent[]): void {
    policyDecisionTimeline.length = 0;
    policyDecisionTimeline.push(...events.map((item) => ({ ...item })));
    if (policyDecisionTimeline.length > POLICY_TIMELINE_LIMIT) {
        policyDecisionTimeline.splice(0, policyDecisionTimeline.length - POLICY_TIMELINE_LIMIT);
    }
}

export function clearPolicyDecisionTimeline(): void {
    policyDecisionTimeline.length = 0;
}

function ensurePolicyDecisionBridge(): void {
    if (policyDecisionBridgeAttached) return;
    policyDecisionBridgeAttached = true;
    policyDecisionBridgeUnsub = onEvent('agent:policy_decision', (msg) => {
        ingestPolicyDecisionEvent(msg);
    });
}

/**
 * 连接到后端 SSE 事件流。
 * EventSource 由浏览器原生管理，自带断线重连。
 */
function connectSSE(url: string, onStatusChange: (s: boolean) => void): EventSource {
    // 先关闭任何已有连接
    if (sseSource) {
        sseSource.close();
        sseSource = null;
    }

    const es = new EventSource(url);

    es.onopen = () => {
        sseConnected = true;
        onStatusChange(true);
    };

    es.onerror = () => {
        sseConnected = false;
        onStatusChange(false);
    };

    es.onmessage = (event) => {
        try {
            const msg: RpcMessage = JSON.parse(event.data);

            if (msg.type === 'event' && msg.name) {
                const handlers = eventHandlers.get(msg.name);
                handlers?.forEach((h) => h(msg));
            }

            // 通用 handler
            const allHandlers = eventHandlers.get('*');
            allHandlers?.forEach((h) => h(msg));
        } catch {
            // 忽略不合法的消息
        }
    };

    sseSource = es;
    return es;
}

/**
 * 发送 RPC 请求（HTTP POST）。
 */
export async function sendRpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = String(callIdCounter++);
    const payload = JSON.stringify({ id, type: 'request', method, params });

    const response = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
    });

    if (!response.ok) {
        throw new Error(`RPC HTTP Error: ${response.status}`);
    }

    const data: RpcMessage = await response.json();
    if (data.error) {
        throw new Error(data.error);
    }

    return data.result as T;
}

/**
 * 注册事件监听器，返回 unsubscribe 函数。
 */
export function onEvent(eventName: string, handler: EventHandler): () => void {
    if (!eventHandlers.has(eventName)) {
        eventHandlers.set(eventName, new Set());
    }
    eventHandlers.get(eventName)!.add(handler);
    return () => {
        eventHandlers.get(eventName)?.delete(handler);
    };
}

/**
 * React Hook: 管理 SSE 连接生命周期。
 * 使用 useRef 防止 StrictMode 双重挂载导致重复连接。
 */
export function useWebSocket() {
    const [connected, setConnected] = useState(sseConnected);
    const cleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        // 如果已有 SSE 连接且仍然活跃，复用它
        if (sseSource && sseSource.readyState !== EventSource.CLOSED) {
            setConnected(sseConnected);
            return;
        }

        const sseUrl = `${window.location.origin}/events`;
        connectSSE(sseUrl, setConnected);
        ensurePolicyDecisionBridge();

        cleanupRef.current = () => {
            if (sseSource) {
                sseSource.close();
                sseSource = null;
                sseConnected = false;
            }
        };

        // StrictMode 下不要在 cleanup 中关闭 SSE
        // 因为 StrictMode 会 mount → unmount → mount，如果 cleanup 关了连接，
        // 第二次 mount 又重新连，会导致服务端看到两次连接。
        // 只在组件真正卸载时（页面跳转）关闭。
        return undefined;
    }, []);

    const rpc = useCallback(sendRpc, []);
    return { connected, sendRpc: rpc };
}

/**
 * React Hook: 监听特定事件。
 * 关键：每次 effect 执行都注册新 handler 并清理旧 handler，
 * 确保 StrictMode 双重挂载不会累积多个 handler。
 */
export function useEvent(eventName: string, handler: EventHandler) {
    const savedHandler = useRef(handler);
    savedHandler.current = handler;

    // 用一个稳定的 ref 持有 unsubscribe 函数
    const unsubRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        // 先清理上一次注册的 handler（防止 StrictMode 累积）
        if (unsubRef.current) {
            unsubRef.current();
        }

        const unsub = onEvent(eventName, (msg) => savedHandler.current(msg));
        unsubRef.current = unsub;

        return () => {
            unsub();
            unsubRef.current = null;
        };
    }, [eventName]);
}

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
}

export interface ApprovalInfo {
    id: string;
    question: string;
    context?: string;
    resolved: boolean;
}

type EventHandler = (msg: RpcMessage) => void;

let callIdCounter = 1;
const pendingCallbacks = new Map<string, (result: unknown) => void>();
const eventHandlers = new Map<string, Set<EventHandler>>();

// ─── SSE: 用于接收服务端事件（单向，仿 opencode /event）───
let sseSource: EventSource | null = null;

// ─── WebSocket: 仅用于发送 RPC 请求 ───
let wsInstance: WebSocket | null = null;

/**
 * 连接到后端 SSE 事件流。
 * EventSource 由浏览器原生管理，自带断线重连，不会因 HMR / StrictMode 产生幽灵连接。
 */
function connectSSE(url: string, onStatusChange: (s: boolean) => void): EventSource {
    const es = new EventSource(url);

    es.onopen = () => {
        onStatusChange(true);
    };

    es.onerror = () => {
        onStatusChange(false);
        // EventSource 自动在内部断线重连，无需手动 setTimeout
    };

    es.onmessage = (event) => {
        try {
            const msg: RpcMessage = JSON.parse(event.data);

            if (msg.type === 'response' && msg.id) {
                const cb = pendingCallbacks.get(msg.id);
                if (cb) {
                    cb(msg.result);
                    pendingCallbacks.delete(msg.id);
                }
            }

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

    return es;
}

/**
 * 连接到后端 WebSocket（仅用于发送 RPC 请求）。
 */
function connectWs(url: string): WebSocket {
    const ws = new WebSocket(url);

    ws.onmessage = (event) => {
        try {
            const msg: RpcMessage = JSON.parse(event.data);
            // WebSocket 现在只处理 RPC 响应（不再接收事件，事件走 SSE）
            if (msg.type === 'response' && msg.id) {
                const cb = pendingCallbacks.get(msg.id);
                if (cb) {
                    cb(msg.result);
                    pendingCallbacks.delete(msg.id);
                }
            }
        } catch {
            // 忽略
        }
    };

    ws.onclose = () => {
        // WebSocket 用于 RPC，断线后自动重连
        if (!(ws as any).intentionalClose) {
            setTimeout(() => {
                wsInstance = connectWs(url);
            }, 3000);
        }
    };

    return ws;
}

/**
 * 发送 RPC 请求并异步等待响应。
 */
export function sendRpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve) => {
        const id = String(callIdCounter++);
        pendingCallbacks.set(id, resolve as (r: unknown) => void);
        wsInstance?.send(JSON.stringify({ id, type: 'request', method, params }));
    });
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
 * React Hook: 管理 SSE + WebSocket 连接生命周期。
 * - SSE (`EventSource`): 接收服务端事件流（单向，不会因 HMR 产生幽灵连接）
 * - WebSocket: 仅用于发送 RPC 请求
 */
export function useWebSocket() {
    const [connected, setConnected] = useState(false);
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const sseUrl = `${window.location.origin}/events`;

        // SSE: 接收所有服务端事件
        sseSource = connectSSE(sseUrl, setConnected);

        // WebSocket: 仅用于发送 RPC 请求
        wsInstance = connectWs(wsUrl);

        return () => {
            if (sseSource) {
                sseSource.close();
                sseSource = null;
            }
            if (wsInstance) {
                (wsInstance as any).intentionalClose = true;
                wsInstance.close();
                wsInstance = null;
            }
            initialized.current = false;
        };
    }, []);

    const rpc = useCallback(sendRpc, []);

    return { connected, sendRpc: rpc };
}

/**
 * React Hook: 监听特定事件。
 */
export function useEvent(eventName: string, handler: EventHandler) {
    const savedHandler = useRef(handler);
    savedHandler.current = handler;

    useEffect(() => {
        return onEvent(eventName, (msg) => savedHandler.current(msg));
    }, [eventName]);
}

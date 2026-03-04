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
const eventHandlers = new Map<string, Set<EventHandler>>();

// ─── SSE: 用于接收服务端事件（单向，仿 opencode /event）───
let sseSource: EventSource | null = null;

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
 * 发送 RPC 请求并异步等待响应（使用 HTTP POST，消除 WebSocket 时序和断线问题）。
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
 * - SSE (`EventSource`): 接收服务端事件流（单向，不会因 HMR 产生幽灵连接）
 * - HTTP fetch: 仅用于发送 RPC 请求
 */
export function useWebSocket() {
    const [connected, setConnected] = useState(false);
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        const sseUrl = `${window.location.origin}/events`;

        // SSE: 接收所有服务端事件
        sseSource = connectSSE(sseUrl, setConnected);

        return () => {
            if (sseSource) {
                sseSource.close();
                sseSource = null;
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

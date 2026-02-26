import { useEffect, useRef, useCallback, useState } from 'react';

// ─── RPC 消息协议（与后端 DaemonServer 一致）───

export interface RpcMessage {
    id?: string;
    type: 'request' | 'response' | 'event';
    method: string;
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
    toolCalls?: ToolCallInfo[];
    approval?: ApprovalInfo;
}

export interface ToolCallInfo {
    name: string;
    args: string;
    result?: string;
    status: 'running' | 'done' | 'error';
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

let wsInstance: WebSocket | null = null;

/**
 * 连接到后端 WebSocket 守护进程。
 */
function connectWs(url: string, onStatusChange: (s: boolean) => void): WebSocket {
    const ws = new WebSocket(url);

    ws.onopen = () => {
        onStatusChange(true);
    };

    ws.onclose = () => {
        onStatusChange(false);
        // 自动重连
        setTimeout(() => {
            wsInstance = connectWs(url, onStatusChange);
        }, 3000);
    };

    ws.onmessage = (event) => {
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
 * React Hook: 管理 WebSocket 连接生命周期。
 */
export function useWebSocket() {
    const [connected, setConnected] = useState(false);
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}`;
        wsInstance = connectWs(url, setConnected);

        return () => {
            wsInstance?.close();
            wsInstance = null;
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

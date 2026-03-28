/**
 * Daemon Server — 无头守护进程 (Headless Daemon)
 *
 * 核心引擎以后台守护进程运行，通过 WebSocket 暴露标准化的 JSON-RPC 事件流。
 * 任何前端（CLI / TUI / Electron / Web / VSCode Extension）都可以连接并消费事件。
 *
 * 支持的 RPC 类型：
 * - Client → Server: 提交任务、审批操作、发送用户输入
 * - Server → Client: 流式推理文本、工具调用通知、审批请求
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 解析 public/ 静态资源目录。
 * 兼容 ESM (import.meta.url) 和 CJS (__dirname) 两种打包产物。
 */
function resolvePublicDir(): string {
    const candidates: string[] = [];

    // 方案 1: 基于 __dirname（CJS 或 tsup 注入）
    if (typeof __dirname !== 'undefined') {
        candidates.push(path.resolve(__dirname, '..', 'public'));
    }

    // 方案 2: 基于 process.argv[1]（入口脚本所在目录）
    if (process.argv[1]) {
        candidates.push(path.resolve(path.dirname(process.argv[1]), '..', 'public'));
        candidates.push(path.resolve(path.dirname(process.argv[1]), 'public'));
    }

    // 方案 3: process.cwd()（开发模式 / 全局 fallback）
    candidates.push(path.join(process.cwd(), 'public'));

    for (const c of candidates) {
        if (fs.existsSync(path.join(c, 'index.html'))) return c;
    }

    // 最终降级
    return candidates[0] || path.join(process.cwd(), 'public');
}

// ─── RPC 消息协议 ───
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

// ─── 服务端事件类型 ───
export type DaemonEventType =
    | 'agent:text'            // Agent 流式文本输出
    | 'agent:tool_call'       // Agent 发起工具调用
    | 'agent:tool_result'     // 工具执行结果
    | 'agent:done'            // 任务完成
    | 'agent:error'           // 错误
    | 'agent:approve'         // Agent 请求审批
    | 'agent:session_changed' // 会话刷新或重置
    | 'approval:request'      // 沙盒审批请求（等待人类确认）
    | 'session:update'        // Session 状态变更
    | 'workspace:list'        // 工作区列表
    | 'session:list'          // 会话列表
    | 'router:decision';      // 路由决策通知

export class DaemonServer extends EventEmitter {
    private wss: WebSocketServer | null = null;
    private httpServer: http.Server | null = null;
    private clients: Set<WebSocket> = new Set();
    private sseClients: Set<http.ServerResponse> = new Set();
    private port: number;

    /** 用于存放等待人类审批的 Promise resolve 回调 */
    private pendingApprovals: Map<string, (answer: string) => void> = new Map();

    constructor(port: number = 9120) {
        super();
        this.port = port;
    }

    /**
     * 启动 HTTP 静态服务 + WebSocket + SSE 守护进程。
     */
    public start(): void {
        const publicDir = resolvePublicDir();
        console.log(`[Daemon] Serving static files from: ${publicDir}`);

        this.httpServer = http.createServer((req, res) => {
            const MIME: Record<string, string> = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.mjs': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.ttf': 'font/ttf',
                '.webp': 'image/webp',
            };

            const urlPath = (req.url || '/').split('?')[0]; // strip query string

            // ── SSE 事件流端点（仿 opencode /event）──
            if (urlPath === '/events' && req.method === 'GET') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',       // 禁止 Nginx 等反代缓冲
                    'X-Content-Type-Options': 'nosniff',
                });

                // 强制单客户端：关闭所有旧的 SSE 连接，防止页面刷新后幽灵连接累积
                for (const oldClient of this.sseClients) {
                    if (!oldClient.writableEnded) {
                        try { oldClient.end(); } catch { /* ignore */ }
                    }
                }
                this.sseClients.clear();

                // 发送连接成功事件
                res.write(`data: ${JSON.stringify({ type: 'event', name: 'server.connected', data: {} })}\n\n`);

                this.sseClients.add(res);
                console.log(`[Daemon] SSE client connected (enforced single-client). Total: ${this.sseClients.size}`);

                // 心跳：每 15 秒发送，防止代理或浏览器超时断开
                const heartbeat = setInterval(() => {
                    if (!res.writableEnded) {
                        res.write(`: heartbeat\n\n`);
                    }
                }, 15_000);

                req.on('close', () => {
                    clearInterval(heartbeat);
                    this.sseClients.delete(res);
                    console.log(`[Daemon] SSE client disconnected. Total: ${this.sseClients.size}`);
                });

                return;
            }

            // ── JSON-RPC over HTTP POST ──
            if (urlPath === '/rpc' && req.method === 'POST') {
                let body = '';
                req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const msg: RpcMessage = JSON.parse(body);
                        // 创建一个假的 "ws" 对象来兼容现有的 handleClientMessage
                        const fakeWs = {
                            readyState: 1, // WebSocket.OPEN
                            send: (payload: string) => {
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(payload);
                            },
                        } as unknown as WebSocket;
                        this.handleClientMessage(fakeWs, msg);
                    } catch {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    }
                });
                return;
            }

            let filePath = path.join(publicDir, urlPath === '/' ? 'index.html' : urlPath);
            const extname = path.extname(filePath);
            const contentType = MIME[extname] || 'application/octet-stream';

            fs.readFile(filePath, (err, content) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        // SPA fallback: if the requested path has no extension, serve index.html
                        if (!extname || extname === '.html') {
                            const indexPath = path.join(publicDir, 'index.html');
                            fs.readFile(indexPath, (err2, indexContent) => {
                                if (err2) {
                                    res.writeHead(500);
                                    res.end('Internal Server Error');
                                } else {
                                    res.writeHead(200, { 'Content-Type': 'text/html' });
                                    res.end(indexContent, 'utf-8');
                                }
                            });
                        } else {
                            res.writeHead(404);
                            res.end('Not found');
                        }
                    } else {
                        res.writeHead(500);
                        res.end(`Server Error: ${err.code}`);
                    }
                } else {
                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Cache-Control': extname === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
                    });
                    res.end(content);
                }
            });
        });

        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            console.log(`[Daemon] WS client connected. Total: ${this.clients.size}`);

            ws.on('message', (raw) => {
                try {
                    const msg: RpcMessage = JSON.parse(raw.toString());
                    this.handleClientMessage(ws, msg);
                } catch (err) {
                    console.error('[Daemon] Invalid message:', err);
                }
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log(`[Daemon] WS client disconnected. Total: ${this.clients.size}`);
            });
        });

        this.httpServer.listen(this.port, () => {
            console.log(`[Daemon] Web Dashboard & WebSocket listening on port ${this.port}`);
            console.log(`[Daemon] Open http://localhost:${this.port} in your browser`);
        });
    }

    public stop(): void {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
        }
        console.log('[Daemon] Server stopped.');
    }

    /**
     * 向所有已连接的客户端广播事件。
     */
    public broadcast(eventType: DaemonEventType, data?: unknown): void {
        const msg: RpcMessage = {
            type: 'event',
            name: eventType,
            data,
        };

        const payload = JSON.stringify(msg);

        // WebSocket clients (legacy, still supported)
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }

        // SSE clients (primary)
        const sseData = `data: ${payload}\n\n`;
        const deadClients: http.ServerResponse[] = [];
        for (const res of this.sseClients) {
            if (res.writableEnded || res.destroyed) {
                deadClients.push(res);
            } else {
                try {
                    res.write(sseData);
                } catch {
                    deadClients.push(res);
                }
            }
        }
        // 清理已断开的僵尸连接
        for (const dead of deadClients) {
            this.sseClients.delete(dead);
        }
    }

    /**
     * 发送审批请求到前端，阻塞等待人类回复。
     * 这是 AskUser 的 Daemon 实现版本。
     */
    public async requestApproval(question: string, context?: string): Promise<string> {
        const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // 广播审批请求
        this.broadcast('approval:request', { id: approvalId, question, context });

        // 如果没有客户端连接，fallback 到 CLI stdin
        if (this.clients.size === 0) {
            return this.fallbackStdinPrompt(question);
        }

        // 等待客户端回复
        return new Promise<string>((resolve) => {
            this.pendingApprovals.set(approvalId, resolve);

            // 超时兜底：60 秒无回复自动拒绝
            setTimeout(() => {
                if (this.pendingApprovals.has(approvalId)) {
                    this.pendingApprovals.delete(approvalId);
                    resolve('no');
                }
            }, 60000);
        });
    }

    // ─── 处理客户端发来的消息 ───
    private handleClientMessage(ws: WebSocket, msg: RpcMessage): void {
        switch (msg.method) {
            case 'task:submit': {
                const prompt = (msg.params?.prompt as string) || '';
                this.emit('task:submit', prompt, msg.id);
                break;
            }

            case 'approval:response':
            case 'approval:respond': { // 兼容旧版本
                const approvalId = (msg.params?.id || msg.params?.approvalId) as string;
                let answer = msg.params?.answer as string;
                if (msg.params?.approved !== undefined) {
                    answer = msg.params?.approved ? 'y' : 'n';
                }
                const resolve = this.pendingApprovals.get(approvalId);
                if (resolve) {
                    resolve(answer);
                    this.pendingApprovals.delete(approvalId);
                }
                break;
            }

            case 'model:list': {
                this.emit('model:list', ws, msg.id);
                break;
            }

            case 'model:switch': {
                const modelId = msg.params?.model as string;
                this.emit('model:switch', modelId, ws, msg.id);
                break;
            }

            case 'agent:list': {
                this.emit('agent:list', ws, msg.id);
                break;
            }

            case 'agent:switch': {
                this.emit('agent:switch', msg.params, ws, msg.id);
                break;
            }

            case 'command:list': {
                this.emit('command:list', msg.params, ws, msg.id);
                break;
            }

            case 'mention:list': {
                this.emit('mention:list', msg.params, ws, msg.id);
                break;
            }

            case 'session:interrupt': {
                this.emit('session:interrupt', ws, msg.id);
                break;
            }

            case 'session:delete': {
                this.emit('session:delete', msg.params, ws, msg.id);
                break;
            }

            case 'session:rename': {
                this.emit('session:rename', msg.params, ws, msg.id);
                break;
            }

            case 'session:compact': {
                this.emit('session:compact', msg.params, ws, msg.id);
                break;
            }

            case 'skill:list': {
                this.emit('skill:list', ws, msg.id);
                break;
            }

            case 'skill:search': {
                this.emit('skill:search', msg.params, ws, msg.id);
                break;
            }

            case 'skill:refresh': {
                this.emit('skill:refresh', ws, msg.id);
                break;
            }

            case 'skill:read': {
                this.emit('skill:read', msg.params, ws, msg.id);
                break;
            }

            case 'skill:write': {
                this.emit('skill:write', msg.params, ws, msg.id);
                break;
            }

            case 'skill:delete': {
                this.emit('skill:delete', msg.params, ws, msg.id);
                break;
            }

            case 'mcp:list': {
                this.emit('mcp:list', ws, msg.id);
                break;
            }

            case 'mcp:create': {
                this.emit('mcp:create', msg.params, ws, msg.id);
                break;
            }

            case 'mcp:update': {
                this.emit('mcp:update', msg.params, ws, msg.id);
                break;
            }

            case 'mcp:delete': {
                this.emit('mcp:delete', msg.params, ws, msg.id);
                break;
            }

            case 'mcp:toggle': {
                this.emit('mcp:toggle', msg.params, ws, msg.id);
                break;
            }

            case 'ritual:status': {
                this.emit('ritual:status', ws, msg.id);
                break;
            }

            case 'session:get': {
                this.emit('session:get', ws, msg.id);
                break;
            }

            case 'workspace:list': {
                this.emit('workspace:list', ws, msg.id);
                break;
            }

            case 'session:list': {
                this.emit('session:list', ws, msg.id);
                break;
            }

            case 'session:create': {
                this.emit('session:create', ws, msg.id);
                break;
            }

            case 'session:switch': {
                const sessionId = msg.params?.sessionId as string;
                this.emit('session:switch', sessionId, ws, msg.id);
                break;
            }

            case 'capsules:list': {
                this.emit('capsules:list', ws, msg.id);
                break;
            }

            case 'blackboard:get': {
                this.emit('blackboard:get', ws, msg.id);
                break;
            }

            case 'session:replay': {
                const sessionId = msg.params?.sessionId as string;
                this.emit('session:replay', sessionId, ws, msg.id);
                break;
            }

            case 'harness:fixture:create': {
                this.emit('harness:fixture:create', msg.params, ws, msg.id);
                break;
            }

            case 'harness:fixture:run': {
                this.emit('harness:fixture:run', msg.params, ws, msg.id);
                break;
            }

            case 'harness:run:get': {
                this.emit('harness:run:get', msg.params, ws, msg.id);
                break;
            }

            case 'harness:report:get': {
                this.emit('harness:report:get', msg.params, ws, msg.id);
                break;
            }

            case 'plugin:list': {
                this.emit('plugin:list', ws, msg.id);
                break;
            }

            case 'plugin:preset:list': {
                this.emit('plugin:preset:list', ws, msg.id);
                break;
            }

            case 'plugin:preset:enable': {
                this.emit('plugin:preset:enable', msg.params, ws, msg.id);
                break;
            }

            case 'plugin:preset:disable': {
                this.emit('plugin:preset:disable', msg.params, ws, msg.id);
                break;
            }

            case 'plugin:capabilities:get': {
                this.emit('plugin:capabilities:get', ws, msg.id);
                break;
            }

            case 'plugin:mcp:save': {
                this.emit('plugin:mcp:save', msg.params, ws, msg.id);
                break;
            }

            default:
                this.sendTo(ws, {
                    id: msg.id,
                    type: 'response',
                    method: msg.method,
                    error: `Unknown method: ${msg.method}`,
                });
        }
    }

    /**
     * 向单个客户端发送响应消息。
     */
    public sendResponse(ws: WebSocket, id: string | undefined, result: unknown): void {
        this.sendTo(ws, {
            id,
            type: 'response',
            method: 'unknown', // RPC 响应通常不需要 method，或者保留原 method
            result,
        });
    }

    /**
     * 向单个客户端发送消息。
     */
    private sendTo(ws: WebSocket, msg: RpcMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    /**
     * Fallback：无客户端连接时使用 stdin 进行审批。
     */
    private fallbackStdinPrompt(question: string): Promise<string> {
        return new Promise((resolve) => {
            process.stdout.write(`\n${question}\n> `);

            const onData = (data: Buffer) => {
                process.stdin.removeListener('data', onData);
                resolve(data.toString().trim());
            };

            process.stdin.resume();
            process.stdin.once('data', onData);
        });
    }
}

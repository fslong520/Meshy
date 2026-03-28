/**
 * MCP Host Runtime — Model Context Protocol 主机运行时
 *
 * 职责：
 * 1. 管理外部 MCP Server 的生命周期（启动、发现、停止）
 * 2. 将 MCP Server 暴露的工具转译为平台内部的 StandardTool 格式
 * 3. 代理 Agent 的 Tool Call 请求到对应的 MCP Server
 * 4. 支持从 `.agent/mcp.json` 配置文件中加载 MCP Server 定义
 *
 * MCP 通信方式 MVP：
 * - 使用 stdio (stdin/stdout) 与子进程通信
 * - 未来可扩展为 WebSocket / HTTP SSE
 */

import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { StandardTool } from '../llm/provider.js';

// ─── MCP Server 配置 ───
export interface McpServerConfig {
    /** 服务名称（唯一标识） */
    name: string;
    /** 传输类型：local = stdio 子进程，remote = SSE/HTTP */
    type?: 'local' | 'remote';
    /** 启动命令（local 模式） */
    command?: string;
    /** 启动参数（local 模式） */
    args?: string[];
    /** 远程 MCP Server URL（remote 模式，如 http://localhost:3001/mcp） */
    url?: string;
    /** 环境变量 */
    env?: Record<string, string>;
    /** 描述信息 */
    description?: string;
    /** 是否在启动时自动拉起（默认 false，实现惰性启动） */
    autoStart?: boolean;
    /** 是否启用（默认 true） */
    enabled?: boolean;
}

// ─── MCP 工具描述（来自 Server 的 tools/list 响应） ───
export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

// ─── MCP Server 实例状态 ───
interface McpServerInstance {
    config: McpServerConfig;
    process: ChildProcess | null;
    tools: McpToolDefinition[];
    status: 'stopped' | 'starting' | 'running' | 'error';
    enabled: boolean;
}

/** UI 向前端暴露的 MCP Server 信息 */
export interface McpServerInfo {
    name: string;
    description: string;
    status: string;
    enabled: boolean;
    toolsCount: number;
    config: McpServerConfig;
}

// ─── JSON-RPC 2.0 消息 ───
interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: number; message: string };
}

export class McpHostRuntime {
    private servers: Map<string, McpServerInstance> = new Map();
    private requestId = 0;
    private workspaceRoot: string;
    private runtimeAllowlist: Set<string> | null = null;

    constructor(workspaceRoot: string = process.cwd()) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * 从 `.agent/mcp.json` 加载 MCP Server 配置。
     */
    public loadConfig(): void {
        const configPath = path.join(this.workspaceRoot, '.agent', 'mcp.json');
        if (!fs.existsSync(configPath)) return;

        try {
            const raw = fs.readFileSync(configPath, 'utf8');
            const configs: McpServerConfig[] = JSON.parse(raw);

            for (const config of configs) {
                const enabled = config.enabled !== false; // 默认 true

                if (!enabled) {
                    console.log(`[MCP] Server "${config.name}" is disabled in mcp.json and will be skipped.`);
                }

                this.servers.set(config.name, {
                    config,
                    process: null,
                    tools: [],
                    status: 'stopped',
                    enabled,
                });
            }

            console.log(`[MCP] Loaded ${configs.length} server config(s)`);
        } catch (err) {
            console.error('[MCP] Failed to load mcp.json:', err);
        }
    }

    public applyRuntimeAllowlist(serverNames: string[]): void {
        this.runtimeAllowlist = new Set(serverNames);
    }

    public getConfiguredServerNames(): string[] {
        return Array.from(this.servers.keys());
    }

    public getActiveRuntimeAllowlist(): string[] {
        return this.runtimeAllowlist ? Array.from(this.runtimeAllowlist) : [];
    }

    private isServerAllowed(name: string): boolean {
        return this.runtimeAllowlist === null || this.runtimeAllowlist.has(name);
    }

    /**
     * 获取当前加载的所有 MCP Server 提供的工具总数
     */
    public getToolCount(): number {
        let count = 0;
        for (const instance of this.servers.values()) {
            count += instance.tools.length;
        }
        return count;
    }

    /**
     * 自动拉起所有配置了 autoStart: true 的 Server
     */
    public async ensureAutoStartServers(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const [name, instance] of this.servers) {
            if (instance.enabled && instance.config.autoStart && instance.status !== 'running') {
                promises.push(this.startServer(name).catch(err => {
                    console.error(`[MCP] Failed to auto-start server ${name}:`, err);
                }));
            }
        }
        await Promise.all(promises);
    }

    /**
     * 启动指定的 MCP Server 子进程，通过 stdio 通信。
     * 注意：remote 类型的 Server 不使用子进程，当前暂不支持自动连接。
     */
    public async startServer(name: string): Promise<void> {
        const instance = this.servers.get(name);
        if (!instance) {
            throw new Error(`MCP Server "${name}" not found in config.`);
        }
        if (!this.isServerAllowed(name)) {
            throw new Error(`MCP Server "${name}" is not currently allowed.`);
        }

        if (instance.status === 'running') return;

        // Remote 类型暂不支持自动启动（需未来实现 SSE/HTTP 客户端）
        if (instance.config.type === 'remote') {
            console.log(`[MCP:${name}] Remote server — manual connection required (url: ${instance.config.url || 'not set'})`);
            instance.status = 'stopped';
            return;
        }

        // Local 类型必须有 command
        const command = instance.config.command;
        if (!command) {
            throw new Error(`MCP Server "${name}" is local but has no command configured.`);
        }

        instance.status = 'starting';

        const childProcess = spawn(command, instance.config.args || [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...instance.config.env },
            cwd: this.workspaceRoot,
        });

        instance.process = childProcess;

        childProcess.on('error', (err: Error) => {
            console.error(`[MCP:${name}] Process error:`, err.message);
            instance.status = 'error';
        });

        childProcess.on('exit', (code: number | null) => {
            console.log(`[MCP:${name}] Process exited with code ${code}`);
            instance.status = 'stopped';
            instance.process = null;
        });

        instance.status = 'running';
        console.log(`[MCP:${name}] Server started`);

        // 初始化：发送 initialize 请求并发现工具
        await this.initializeServer(name);
    }

    /**
     * 停止指定的 MCP Server。
     */
    public stopServer(name: string): void {
        const instance = this.servers.get(name);
        if (!instance?.process) return;

        instance.process.kill();
        instance.process = null;
        instance.status = 'stopped';
        console.log(`[MCP:${name}] Server stopped`);
    }

    /**
     * 停止所有运行中的 MCP Server。
     */
    public stopAll(): void {
        for (const name of this.servers.keys()) {
            this.stopServer(name);
        }
    }

    /**
     * 获取 MCP 工具列表（按需加载机制）：
     * - 对于已经激活的 Server，返回其完整的所有 Tool Definition。
     * - 对于未激活的 Server，只返回一个用于加载对应 Server 的元工具（Meta-Tool），
     *   极大节省 Token 并提高 LLM 的指令聚焦度。
     */
    public getAllTools(activatedServers: Set<string>): StandardTool[] {
        const tools: StandardTool[] = [];

        for (const [serverName, instance] of this.servers) {
            if (!this.isServerAllowed(serverName)) {
                continue;
            }

            // 如果此服务器已被激活并加载了全量 Schema
            if (activatedServers.has(serverName)) {
                for (const tool of instance.tools) {
                    tools.push({
                        name: `mcp:${serverName}:${tool.name}`,
                        description: `[MCP:${serverName}] ${tool.description}`,
                        inputSchema: tool.inputSchema,
                    });
                }
            } else {
                // 如果未激活，仅暴露一个按需加载的 Meta Tool
                // 这个描述必须足够清晰，让 LLM 知道如果要用这个领域的功能，得先调用此工具
                const desc = instance.config.description || `Provides tools for ${serverName}`;
                tools.push({
                    name: `_load_mcp_server_${serverName.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
                    description: `[Meta-Tool] Before using features related to "${serverName}", you MUST call this tool. Reason: ${desc}. This will load the full tool schemas for this server so you can use them in your next steps.`,
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                });
            }
        }
        return tools;
    }

    /**
     * 获取所有 MCP Server 的基本信息（名称 + 描述），用于生成轻量广告文本。
     */
    public getServerSummaries(): Array<{ name: string; description: string; status: string }> {
        return Array.from(this.servers.values()).map(s => ({
            name: s.config.name,
            description: s.config.description || '',
            status: s.status,
        }));
    }

    // ═══════════════════════════════════════════
    // Management — 配置管理 CRUD
    // ═══════════════════════════════════════════

    /**
     * 获取所有 MCP Server 的完整信息，供 UI 列表展示。
     */
    public getServerList(): McpServerInfo[] {
        return Array.from(this.servers.values()).map(s => ({
            name: s.config.name,
            description: s.config.description || '',
            status: s.enabled ? s.status : 'disabled',
            enabled: s.enabled,
            toolsCount: s.tools.length,
            config: s.config,
        }));
    }

    /**
     * 添加一个新的 MCP Server 配置并持久化到 `.agent/mcp.json`。
     * 若 `enabled` 字段未传入，默认为 true。
     */
    public addServer(config: McpServerConfig): void {
        if (this.servers.has(config.name)) {
            throw new Error(`MCP Server "${config.name}" already exists.`);
        }

        const enabled = config.enabled !== false;
        this.servers.set(config.name, {
            config: { ...config, enabled },
            process: null,
            tools: [],
            status: 'stopped',
            enabled,
        });

        this.saveConfig();
        console.log(`[MCP] Added server: ${config.name} (type=${config.type || 'local'})`);
    }

    /**
     * 更新已有 MCP Server 的配置。
     * 如果 Server 正在运行，先停止再更新。
     */
    public updateServer(name: string, newConfig: McpServerConfig): void {
        const instance = this.servers.get(name);
        if (!instance) {
            throw new Error(`MCP Server "${name}" not found.`);
        }

        // 如果正在运行，先停止
        if (instance.status === 'running') {
            this.stopServer(name);
        }

        // 如果改名，删除旧的再设新的
        if (newConfig.name !== name) {
            this.servers.delete(name);
        }

        const enabled = newConfig.enabled !== false;
        this.servers.set(newConfig.name, {
            config: { ...newConfig, enabled },
            process: null,
            tools: [],
            status: 'stopped',
            enabled,
        });

        this.saveConfig();
        console.log(`[MCP] Updated server: ${name} -> ${newConfig.name}`);
    }

    /**
     * 移除 MCP Server 配置并持久化。
     * 如果 Server 正在运行，先停止。
     */
    public removeServer(name: string): void {
        const instance = this.servers.get(name);
        if (!instance) {
            throw new Error(`MCP Server "${name}" not found.`);
        }

        if (instance.status === 'running') {
            this.stopServer(name);
        }

        this.servers.delete(name);
        this.saveConfig();
        console.log(`[MCP] Removed server: ${name}`);
    }

    /**
     * 启用或禁用 MCP Server。
     * enabled=true  → 将状态设为 stopped（可被后续 startServer 拉起）
     * enabled=false → 停止运行中的进程并标记为 disabled
     */
    public async toggleServer(name: string, enabled: boolean): Promise<void> {
        const instance = this.servers.get(name);
        if (!instance) {
            throw new Error(`MCP Server "${name}" not found.`);
        }

        instance.enabled = enabled;
        instance.config.enabled = enabled;

        if (!enabled && instance.status === 'running') {
            this.stopServer(name);
        }

        if (enabled && instance.config.autoStart && instance.status !== 'running') {
            await this.startServer(name).catch(err => {
                console.error(`[MCP] Failed to start server ${name} after enable:`, err);
            });
        }

        this.saveConfig();
        console.log(`[MCP] ${name} ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * 将当前内存中的 Server 配置序列化到 `.agent/mcp.json`。
     */
    public saveConfig(): void {
        const configPath = path.join(this.workspaceRoot, '.agent', 'mcp.json');
        const dir = path.dirname(configPath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const configs = Array.from(this.servers.values()).map(s => s.config);
        fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
    }

    /**
     * 代理执行 MCP 工具调用。
     * 传入的 toolName 格式为 `mcp:<serverName>:<toolName>`。
     */
    public async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<string> {
        const parts = qualifiedName.split(':');
        if (parts.length < 3 || parts[0] !== 'mcp') {
            throw new Error(`Invalid MCP tool name format: ${qualifiedName}`);
        }

        const serverName = parts[1];
        const toolName = parts.slice(2).join(':');

        const instance = this.servers.get(serverName);
        if (!instance) {
            throw new Error(`MCP Server "${serverName}" not found.`);
        }
        if (!this.isServerAllowed(serverName)) {
            throw new Error(`MCP Server "${serverName}" is not currently allowed.`);
        }

        // 惰性启动：如果 Server 未运行则自动拉起
        if (instance.status !== 'running') {
            await this.startServer(serverName);
        }

        return this.sendRpcRequest(instance, 'tools/call', {
            name: toolName,
            arguments: args,
        });
    }

    // ═══════════════════════════════════════════
    // Internal — JSON-RPC 通信
    // ═══════════════════════════════════════════

    private async initializeServer(name: string): Promise<void> {
        const instance = this.servers.get(name);
        if (!instance) return;

        try {
            // 发送 initialize 请求
            await this.sendRpcRequest(instance, 'initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'meshy', version: '1.0.0' },
            });

            // 发现可用工具
            const toolsResponse = await this.sendRpcRequest(instance, 'tools/list', {});
            try {
                const toolsData = JSON.parse(toolsResponse);
                if (Array.isArray(toolsData.tools)) {
                    instance.tools = toolsData.tools;
                    console.log(`[MCP:${name}] Discovered ${instance.tools.length} tool(s)`);
                }
            } catch {
                // tools/list 可能不返回 JSON，忽略
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[MCP:${name}] Initialize failed: ${message}`);
        }
    }

    private sendRpcRequest(instance: McpServerInstance, method: string, params: Record<string, unknown>): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!instance.process?.stdin || !instance.process?.stdout) {
                reject(new Error('MCP Server process is not available.'));
                return;
            }

            const id = ++this.requestId;
            const request: JsonRpcRequest = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };

            const onData = (data: Buffer) => {
                try {
                    const lines = data.toString().split('\n').filter(Boolean);
                    for (const line of lines) {
                        const response: JsonRpcResponse = JSON.parse(line);
                        if (response.id === id) {
                            instance.process?.stdout?.removeListener('data', onData);
                            if (response.error) {
                                reject(new Error(response.error.message));
                            } else {
                                resolve(JSON.stringify(response.result));
                            }
                            return;
                        }
                    }
                } catch {
                    // 不是此请求的响应，继续等待
                }
            };

            instance.process.stdout.on('data', onData);

            // 发送请求
            instance.process.stdin.write(JSON.stringify(request) + '\n');

            // 超时兜底
            setTimeout(() => {
                instance.process?.stdout?.removeListener('data', onData);
                reject(new Error(`MCP RPC timeout for method "${method}"`));
            }, 15000);
        });
    }
}

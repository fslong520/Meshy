import 'dotenv/config';
import { loadConfig } from './config/index.js';
import { Session } from './core/session/state.js';
import { TaskEngine } from './core/engine/index.js';
import { DaemonServer } from './core/daemon/server.js';
import { WorkspaceManager } from './core/workspace/manager.js';
import { SessionManager } from './core/session/manager.js';
import { exportReplay, loadReplay } from './core/session/replay.js';
import { terminalManager } from './core/terminal/manager.js';
import { HarnessServerAdapter } from './core/server/harness/adapter.js';
import { PluginLoader } from './core/plugins/loader.js';
import { PluginRegistry } from './core/plugins/registry.js';
import { ServerPluginAdapter } from './core/server/plugins/adapter.js';
import { saveProjectedMcpConfig } from './core/plugins/runtime/mcp-persistence.js';
import { rankSkills } from './core/skills/retrieval.js';
import { deriveSkillRetrievalBias } from './core/plugins/runtime/skill-bias.js';
import type { ToolManifestEntry } from './core/tool/registry.js';
import type { ToolPolicyMode } from './core/tool/registry.js';
import fs from 'fs';
import path from 'path';

// ─── CLI 参数解析 ───

interface ParsedArgs {
    subcommand: 'server' | 'run' | 'interactive';
    prompt: string;
    model: string | null;
    port: number;
    file: string | null;
    autoConfirm: boolean;
}

/**
 * 解析 CLI 参数，支持以下格式：
 *
 * meshy server [--port 9120]               → 启动 Web Dashboard
 * meshy daemon [--port 9120]               → 启动 Web Dashboard（兼容别名）
 * meshy -p "prompt" [-m model]             → 一次性执行
 * meshy --print "prompt" [-m model]        → 一次性执行（别名）
 * meshy run "prompt" [-m model]            → 一次性执行（OpenCode 风格）
 * meshy run -m model -f file "prompt"      → 指定文件 + 模型
 * meshy "prompt"                           → 一次性执行（简写）
 * meshy                                    → 交互式 REPL（未来）
 */
export function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2); // 跳过 node + 脚本路径

    const result: ParsedArgs = {
        subcommand: 'interactive',
        prompt: '',
        model: null,
        port: 9120,
        file: null,
        autoConfirm: false,
    };

    // 快速检查第一个非 flag 参数是否为子命令
    const firstArg = args[0];

    if (firstArg === 'server' || firstArg === 'daemon') {
        result.subcommand = 'server';
        // 解析 server 专用参数
        const portIdx = args.indexOf('--port');
        if (portIdx !== -1 && args[portIdx + 1]) {
            result.port = parseInt(args[portIdx + 1], 10) || 9120;
        }
        return result;
    }

    if (firstArg === 'run') {
        result.subcommand = 'run';
        args.shift(); // 消费 'run'
    }

    // 解析 flags
    const positionals: string[] = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === '-p' || arg === '--print') {
            result.subcommand = 'run';
            if (args[i + 1] && !args[i + 1].startsWith('-')) {
                positionals.push(args[i + 1]);
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }

        if (arg === '-m' || arg === '--model') {
            result.model = args[i + 1] || null;
            i += 2;
            continue;
        }

        if (arg === '-f' || arg === '--file') {
            result.file = args[i + 1] || null;
            i += 2;
            continue;
        }

        if (arg === '--port') {
            result.port = parseInt(args[i + 1], 10) || 9120;
            i += 2;
            continue;
        }

        // 兼容旧 --daemon flag
        if (arg === '--daemon') {
            result.subcommand = 'server';
            i += 1;
            continue;
        }

        if (arg === '-y' || arg === '--yes') {
            result.autoConfirm = true;
            i += 1;
            continue;
        }

        // 位置参数（prompt 文本）
        if (!arg.startsWith('-')) {
            positionals.push(arg);
        }

        i += 1;
    }

    // 拼合位置参数为 prompt
    if (positionals.length > 0) {
        result.prompt = positionals.join(' ');
        if (result.subcommand === 'interactive') {
            result.subcommand = 'run';
        }
    }

    return result;
}

// ─── Pipe / Stdin 检测 ───

async function readStdin(): Promise<string> {
    // 只有非 TTY（管道模式）才读取 stdin
    if (process.stdin.isTTY) return '';

    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => { resolve(data.trim()); });
        // 设置超时，避免用户在交互模式意外挂起
        setTimeout(() => resolve(data.trim()), 500);
    });
}

// ─── 主流程 ───

export async function runMeshy(prompt: string, options?: { model?: string | null; autoConfirm?: boolean }) {
    // 1. Load configuration
    const config = loadConfig();
    const providerNames = Object.keys(config.providers);
    console.log(`[Meshy] Loaded Config. Providers: [${providerNames.join(', ')}] | Default: ${config.models.default}`);

    // 2. Initialize the Provider Resolver
    const { ProviderResolver } = await import('./core/llm/resolver.js');
    const providerResolver = new ProviderResolver(config);

    // 如果指定了模型覆盖，立即切换
    if (options?.model) {
        providerResolver.switchModel(options.model);
        console.log(`[Meshy] Model override: ${options.model}`);
    }

    // 3. Initialize Workspace & Session
    const workspaceManager = new WorkspaceManager(providerResolver);
    const activeWorkspace = workspaceManager.getWorkspace(process.cwd());
    const sessionManager = new SessionManager(activeWorkspace.rootPath);

    let session: Session;
    let isResuming = false;

    // Phase 5/8: Workspace-aware Session Recovery
    const latestCrashedSession = activeWorkspace.snapshotManager.loadLatestSession();

    if (latestCrashedSession) {
        const answer = await promptUser(`[Meshy] Detected an interrupted session (${latestCrashedSession.id}) in workspace. Resume? [y/N]: `);
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            session = latestCrashedSession;
            isResuming = true;
        } else {
            console.log(`[Meshy] Discarding interrupted session.`);
            activeWorkspace.snapshotManager.clearSnapshot(latestCrashedSession.id);
            session = sessionManager.createSession();
        }
    } else {
        session = sessionManager.createSession();
    }

    // 4. Start Task Engine
    const engine = new TaskEngine(providerResolver, activeWorkspace, session, {
        maxRetries: config.system.maxRetries,
        executionMode: options?.autoConfirm ? 'yolo' as any : undefined,
    });

    // Cache skills in memory on startup
    engine.getSkillRegistry().scan(activeWorkspace.rootPath);

    if (isResuming) {
        console.log(`[Meshy] Resuming task...`);
        await engine.resumeTask();
    } else {
        console.log(`[Meshy] Starting task...`);
        await engine.runTask(prompt);
    }

    console.log(`\n[Meshy] Task completed. Exiting.`);

    // 释放本地 ERNIE 小模型资源
    engine.shutdown();

    process.exit(0);
}

export function registerServerRuntimeHandlers(
    daemon: {
        on: (event: string, handler: (...args: any[]) => void) => void;
        sendResponse: (ws: any, id: string | undefined, result: unknown) => void;
    },
    harness: {
        createFixtureFromReplay: (replayPath: string, options?: Record<string, unknown>) => Promise<{ fixtureId: string }>;
        runFixture: (fixtureId: string) => Promise<unknown>;
        getRun: (runId: string) => Promise<unknown>;
        getReport: (reportId: string) => Promise<unknown>;
    },
    plugins: {
        listPlugins: () => unknown;
        listPresets: () => unknown;
        enablePreset: (id: string) => Promise<unknown>;
        disablePreset: (id: string) => Promise<unknown>;
        getActiveCapabilities: () => unknown;
        getActiveMcpProjection: () => unknown;
        saveMcpProjection: (workspaceRoot: string) => Promise<unknown>;
    },
    tools?: {
        listManifestEntries: () => ToolManifestEntry[];
        getManifest: (name: string) => ToolManifestEntry['manifest'] | null;
        getPolicyMode: () => ToolPolicyMode;
        setPolicyMode: (mode: ToolPolicyMode) => void;
        getPolicyHistory: () => Array<{ previousMode: ToolPolicyMode; nextMode: ToolPolicyMode; changedAt: string; source: string }>;
        appendPolicyHistory: (entry: { previousMode: ToolPolicyMode; nextMode: ToolPolicyMode; changedAt: string; source: string }) => void;
        summarizeManifestEntries: () => {
            total: number;
            bySource: { builtin: number; catalog: number };
            byPermissionClass: Record<string, number | undefined>;
            timeoutConfigured: number;
            retryable: number;
        };
    },
): void {
    daemon.on('harness:fixture:create', async (params: any, ws: any, msgId: string) => {
        try {
            const replayPath = params?.replayPath as string;
            const options = (params?.options ?? {}) as Record<string, unknown>;
            const result = await harness.createFixtureFromReplay(replayPath, options);
            daemon.sendResponse(ws, msgId, result);
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('harness:fixture:run', async (params: any, ws: any, msgId: string) => {
        try {
            const result = await harness.runFixture(params?.fixtureId as string);
            daemon.sendResponse(ws, msgId, result);
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('harness:run:get', async (params: any, ws: any, msgId: string) => {
        try {
            const result = await harness.getRun(params?.runId as string);
            daemon.sendResponse(ws, msgId, result);
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('harness:report:get', async (params: any, ws: any, msgId: string) => {
        try {
            const result = await harness.getReport(params?.reportId as string);
            daemon.sendResponse(ws, msgId, result);
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('plugin:list', (ws: any, msgId: string) => {
        daemon.sendResponse(ws, msgId, { plugins: plugins.listPlugins() });
    });

    daemon.on('plugin:preset:list', (ws: any, msgId: string) => {
        daemon.sendResponse(ws, msgId, { presets: plugins.listPresets() });
    });

    daemon.on('plugin:preset:enable', async (params: any, ws: any, msgId: string) => {
        try {
            const result = await plugins.enablePreset(params?.id as string) as Record<string, unknown>;
            daemon.sendResponse(ws, msgId, { success: true, ...result });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('plugin:preset:disable', async (params: any, ws: any, msgId: string) => {
        try {
            const result = await plugins.disablePreset(params?.id as string) as Record<string, unknown>;
            daemon.sendResponse(ws, msgId, { success: true, ...result });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('plugin:capabilities:get', (ws: any, msgId: string) => {
        daemon.sendResponse(ws, msgId, {
            capabilities: plugins.getActiveCapabilities(),
            projection: plugins.getActiveMcpProjection(),
        });
    });

    daemon.on('plugin:mcp:save', async (params: any, ws: any, msgId: string) => {
        try {
            const result = await plugins.saveMcpProjection(params?.workspaceRoot as string) as Record<string, unknown>;
            daemon.sendResponse(ws, msgId, { success: true, ...result });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('tool:manifest:list', (params: any, ws: any, msgId: string) => {
        if (!tools) {
            daemon.sendResponse(ws, msgId, { manifests: [] });
            return;
        }

        const source = typeof params?.source === 'string' ? params.source : undefined;
        const permissionClass = typeof params?.permissionClass === 'string' ? params.permissionClass : undefined;

        const manifests = tools
            .listManifestEntries()
            .filter((entry) => !source || entry.source === source)
            .filter((entry) => !permissionClass || entry.manifest.permissionClass === permissionClass);

        daemon.sendResponse(ws, msgId, {
            manifests,
            policy: {
                mode: tools.getPolicyMode(),
            },
            summary: tools.summarizeManifestEntries(),
        });
    });

    daemon.on('tool:manifest:get', (params: any, ws: any, msgId: string) => {
        const name = typeof params?.name === 'string' ? params.name : '';
        if (!tools || !name) {
            daemon.sendResponse(ws, msgId, { name, manifest: null });
            return;
        }

        daemon.sendResponse(ws, msgId, {
            name,
            manifest: tools.getManifest(name),
        });
    });

    daemon.on('tool:policy:get', (ws: any, msgId: string) => {
        if (!tools) {
            daemon.sendResponse(ws, msgId, { mode: 'standard' });
            return;
        }

        daemon.sendResponse(ws, msgId, {
            mode: tools.getPolicyMode(),
        });
    });

    daemon.on('tool:policy:set', (params: any, ws: any, msgId: string) => {
        if (!tools) {
            daemon.sendResponse(ws, msgId, { success: false, error: 'Tool policy adapter unavailable.' });
            return;
        }

        const mode = params?.mode;
        if (mode !== 'standard' && mode !== 'read_only') {
            daemon.sendResponse(ws, msgId, {
                success: false,
                error: `Invalid policy mode: ${String(mode)}`,
            });
            return;
        }

        const previousMode = tools.getPolicyMode();
        tools.setPolicyMode(mode);
        if (previousMode !== mode) {
            tools.appendPolicyHistory({
                previousMode,
                nextMode: mode,
                changedAt: new Date().toISOString(),
                source: 'runtime-api',
            });
        }

        daemon.sendResponse(ws, msgId, {
            success: true,
            mode: tools.getPolicyMode(),
        });
    });

    daemon.on('tool:policy:history', (ws: any, msgId: string) => {
        if (!tools) {
            daemon.sendResponse(ws, msgId, { entries: [] });
            return;
        }

        daemon.sendResponse(ws, msgId, {
            entries: tools.getPolicyHistory(),
        });
    });
}

export function searchSkillsWithBias(
    query: string,
    registry: { listSkills(): any[] },
    pluginAdapter: { getActiveCapabilities(): unknown },
) {
    const skills = registry.listSkills();
    const bias = deriveSkillRetrievalBias({
        activeCapabilities: pluginAdapter.getActiveCapabilities() as any,
    });
    return rankSkills({
        query,
        skills,
        bias,
    }).map(entry => entry.skill);
}

// ─── 自定义 Provider 配置持久化 ───

/**
 * 将 provider 配置写入 .agent/config.json
 */
async function persistProviderConfig(
    rootPath: string,
    updater: (providers: Record<string, any>) => Record<string, any>,
): Promise<void> {
    const configDir = path.join(rootPath, '.agent');
    const configPath = path.join(configDir, 'config.json');

    // Ensure .agent directory exists
    await fs.promises.mkdir(configDir, { recursive: true });

    let current: Record<string, any> = {};
    try {
        const raw = await fs.promises.readFile(configPath, 'utf-8');
        current = JSON.parse(raw);
    } catch {
        // File doesn't exist or invalid JSON — start fresh
        current = {};
    }

    if (!current.providers) {
        current.providers = {};
    }

    current.providers = updater(current.providers);

    await fs.promises.writeFile(configPath, JSON.stringify(current, null, 2), 'utf-8');
    console.log(`[Config] Persisted provider config to ${configPath}`);
}

export async function runServer(port: number) {
    const config = loadConfig();
    const providerNames = Object.keys(config.providers);
    console.log(`[Meshy] Loaded Config. Providers: [${providerNames.join(', ')}] | Default: ${config.models.default}`);

    const { ProviderResolver } = await import('./core/llm/resolver.js');
    const providerResolver = new ProviderResolver(config);

    const workspaceManager = new WorkspaceManager(providerResolver);
    let activeWorkspace = workspaceManager.getWorkspace(process.cwd());
    let sessionManager = new SessionManager(activeWorkspace.rootPath);

    let session: import('./core/session/state.js').Session;
    const summaries = sessionManager.listSessions();
    if (summaries.length > 0) {
        session = sessionManager.loadSession(summaries[0].id) || sessionManager.createSession();
    } else {
        session = sessionManager.createSession();
    }

    // 启动 Daemon Server
    const daemon = new DaemonServer(port);
    daemon.start();

    const engine = new TaskEngine(providerResolver, activeWorkspace, session, {
        maxRetries: config.system.maxRetries,
        daemon,
    });

    const restoredMode = session.toolPolicyMode;
    engine.getToolRegistry().setPolicyMode(restoredMode === 'read_only' ? 'standard' : (restoredMode || 'standard'));

    const harnessAdapter = new HarnessServerAdapter(activeWorkspace.rootPath);
    const pluginRoot = path.join(activeWorkspace.rootPath, '.meshy', 'plugins');
    const pluginLoader = new PluginLoader([pluginRoot]);
    const pluginRegistry = new PluginRegistry(pluginLoader.loadAll());
    const pluginAdapter = new ServerPluginAdapter(
        pluginRegistry,
        activeWorkspace.mcpHost,
        saveProjectedMcpConfig,
    );
    registerServerRuntimeHandlers(daemon, harnessAdapter, pluginAdapter, {
        listManifestEntries: () => engine.getToolRegistry().listManifestEntries(),
        getManifest: (name: string) => engine.getToolRegistry().getManifest(name),
        getPolicyMode: () => engine.getToolRegistry().getPolicyMode(),
        setPolicyMode: (mode) => {
            engine.getToolRegistry().setPolicyMode(mode);
            session.toolPolicyMode = mode;
        },
        getPolicyHistory: () => session.toolPolicyHistory,
        appendPolicyHistory: (entry) => {
            session.toolPolicyHistory.push(entry);
            sessionManager.saveSession(session);
        },
        summarizeManifestEntries: () => engine.getToolRegistry().summarizeManifestEntries(),
    });

    // Cache skills in memory on startup
    engine.getSkillRegistry().scan(activeWorkspace.rootPath);

    // 监听 Web UI 发来的独立任务
    daemon.on('task:submit', async (payload: any, id?: string) => {
        let submittedPrompt = '';
        let contextOpts: any = {};

        if (typeof payload === 'string') {
            submittedPrompt = payload;
        } else {
            submittedPrompt = payload.prompt || '';
            contextOpts = {
                mode: payload.mode,
                attachments: payload.attachments,
                temperature: payload.temperature,
                maxTokens: payload.maxTokens,
                topP: payload.topP,
            };
        }

        console.log(`\n[Meshy] Received task from Web UI: ${submittedPrompt}`);
        try {
            const isNew = session.history.length === 0;
            if (isNew) {
                session.title = submittedPrompt.slice(0, 30) + (submittedPrompt.length > 30 ? '...' : '');
            }

            await engine.runTask(submittedPrompt, contextOpts);

            daemon.broadcast('session:list', { sessions: sessionManager.listSessions() });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[Meshy] Task from Web UI failed:', msg);
            daemon.broadcast('agent:text', {
                text: `\n⚠️ 任务执行失败: ${msg}`,
                id: `error-${Date.now()}`,
            });
        } finally {
            // 从 session 历史中取最后一条 assistant 消息的完整内容，附带在 agent:done 中
            // 解决 SSE 断连导致前端无内容的问题
            let finalContent = '';
            const lastAssistantMsg = [...session.history].reverse().find(m => m.role === 'assistant');
            if (lastAssistantMsg && typeof lastAssistantMsg.content === 'string') {
                finalContent = lastAssistantMsg.content;
            }
            daemon.broadcast('agent:done', { id, finalContent });
        }
    });

    daemon.on('session:interrupt', () => {
        console.log(`\n[Meshy] Web UI requested session interrupt.`);
        engine.interrupt();
    });

    daemon.on('workspace:add', (path: string, ws, msgId) => {
        try {
            workspaceManager.addWorkspace(path);
            daemon.sendResponse(ws, msgId, { success: true });

            // Broadcast update
            daemon.broadcast('workspace:list', { workspaces: workspaceManager.listWorkspaces() });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('workspace:remove', (path: string, ws, msgId) => {
        try {
            workspaceManager.removeWorkspace(path);
            daemon.sendResponse(ws, msgId, { success: true });

            // Broadcast update
            daemon.broadcast('workspace:list', { workspaces: workspaceManager.listWorkspaces() });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('workspace:switch', async (targetPath: string, ws, msgId) => {
        try {
            // Hot-swap backend context
            activeWorkspace = workspaceManager.getWorkspace(targetPath);
            await activeWorkspace.memoryStore.initialize();
            sessionManager = new SessionManager(activeWorkspace.rootPath, activeWorkspace.snapshotManager, activeWorkspace.reflectionEngine);
            engine.workspace = activeWorkspace;
            engine.getSkillRegistry().scan(activeWorkspace.rootPath);

            // Load latest session or create new
            const summaries = sessionManager.listSessions();
            if (summaries.length > 0) {
                session = sessionManager.loadSession(summaries[0].id) || sessionManager.createSession();
            } else {
                session = sessionManager.createSession();
            }
            engine.setSession(session);

            console.log(`[Meshy] Switched daemon workspace context to: ${targetPath}`);
            const mcpCount = activeWorkspace.mcpHost.getServerList().filter(s => s.enabled).length;
            if (mcpCount === 0) {
                console.log(`[Meshy] Notice: The new workspace '${path.basename(targetPath)}' has no enabled MCP servers configured in .agent/mcp.json`);
            } else {
                console.log(`[Meshy] Notice: Found ${mcpCount} enabled MCP server(s) in workspace '${path.basename(targetPath)}'`);
            }

            const replay = exportReplay(session);
            daemon.sendResponse(ws, msgId, {
                success: true,
                targetPath,
                sessionId: session.id,
                replay
            });

            // Broadcast workspace update out in case other clients are connected
            daemon.broadcast('workspace:list', { workspaces: workspaceManager.listWorkspaces() });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('workspace:list', (ws, msgId) => {
        daemon.sendResponse(ws, msgId, {
            workspaces: workspaceManager.listWorkspaces(),
            activeWorkspace: engine.workspace.rootPath
        });
    });

    daemon.on('session:list', (ws: import('ws').WebSocket, msgId: string) => {
        daemon.sendResponse(ws, msgId, {
            sessions: sessionManager.listSessions()
        });
    });

    daemon.on('session:create', (ws: import('ws').WebSocket, msgId: string) => {
        const newSession = sessionManager.createSession();
        console.log(`[Meshy] Web UI created new session: ${newSession.id}`);

        // Fix: Persist the new session to disk immediately so session:switch can load it
        sessionManager.saveSession(newSession);

        // Explicitly update the global session state and task engine
        session = newSession;
        engine.setSession(newSession);

        daemon.sendResponse(ws, msgId, {
            sessionId: newSession.id,
            sessions: sessionManager.listSessions(),
        });
    });

    // ── 模型微调参数存取 ──
    // 用 preferences 表持久化（通过 activeWorkspace.memoryStore）
    daemon.on('model:fine-tune:get', async (_ws: import('ws').WebSocket, msgId: string) => {
        try {
            const temp = await activeWorkspace.memoryStore.getPreference('fine_tune_temperature');
            const tokens = await activeWorkspace.memoryStore.getPreference('fine_tune_max_tokens');
            const topP = await activeWorkspace.memoryStore.getPreference('fine_tune_top_p');
            daemon.sendResponse(_ws, msgId, {
                temperature: temp ? parseFloat(temp) : 0.7,
                maxTokens: tokens ? parseInt(tokens, 10) : 4096,
                topP: topP ? parseFloat(topP) : 1.0,
            });
        } catch { daemon.sendResponse(_ws, msgId, { temperature: 0.7, maxTokens: 4096, topP: 1.0 }); }
    });

    daemon.on('model:fine-tune:set', async (params: any, ws: import('ws').WebSocket, msgId: string) => {
        try {
            const store = activeWorkspace.memoryStore;
            if (params.temperature !== undefined) await store.setPreference('fine_tune_temperature', String(params.temperature));
            if (params.maxTokens !== undefined) await store.setPreference('fine_tune_max_tokens', String(params.maxTokens));
            if (params.topP !== undefined) await store.setPreference('fine_tune_top_p', String(params.topP));
            daemon.sendResponse(ws, msgId, { success: true });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    // ── 当前 session 状态 ──
    daemon.on('session:get', (ws: import('ws').WebSocket, msgId: string) => {
        // 返回当前活跃 session 的 replay 数据
        const replay = exportReplay(session);
        daemon.sendResponse(ws, msgId, {
            sessionId: session.id,
            replay,
        });
    });

    daemon.on('session:switch', async (sessionId: string, ws: import('ws').WebSocket, msgId: string) => {
        const loaded = sessionManager.loadSession(sessionId);
        if (loaded) {
            // Validate existing background processes (they might have died while session was unloaded or via a daemon restart)
            const validProcesses = [];
            for (const p of loaded.backgroundProcesses) {
                if (terminalManager.validateProcessActiveness(p.id)) {
                    validProcesses.push(p);
                }
            }
            loaded.backgroundProcesses = validProcesses;

            // Update the global session and engine context so new messages hit the loaded session
            session = loaded;
            engine.setSession(loaded);

            // Fetch the history replay Data
            const replay = exportReplay(loaded);
            daemon.sendResponse(ws, msgId, {
                success: true,
                sessionId,
                replay,
            });
        } else {
            daemon.sendResponse(ws, msgId, { success: false, error: 'Session not found' });
        }
    });

    daemon.on('session:delete', async (params: any, ws: import('ws').WebSocket, msgId: string) => {
        try {
            const { id } = params;
            if (!id) throw new Error('Session ID is required');
            await sessionManager.deleteSession(id, activeWorkspace.memoryStore);

            let newActiveId = session.id;
            
            // If deleting active session, pick the next available or create new
            if (session.id === id) {
                const remaining = sessionManager.listSessions();
                if (remaining.length > 0) {
                    const loaded = sessionManager.loadSession(remaining[0].id);
                    if (loaded) {
                        session = loaded;
                        engine.setSession(loaded);
                        newActiveId = session.id;
                    }
                } else {
                    const fresh = sessionManager.createSession();
                    session = fresh;
                    engine.setSession(fresh);
                    newActiveId = fresh.id;
                }
            }

            daemon.sendResponse(ws, msgId, {
                success: true,
                sessions: sessionManager.listSessions(),
                activeSessionId: newActiveId
            });
            // Update all connected clients' sidebars
            daemon.broadcast('session:list', { sessions: sessionManager.listSessions() });
            
            // If the active session changed due to deletion, notify UI to switch context
            if (newActiveId !== session.id || id === params.id) {
                 daemon.broadcast('agent:session_changed', { sessionId: newActiveId });
            }
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('session:rename', (params: any, ws: import('ws').WebSocket, msgId: string) => {
        try {
            const { id, title } = params;
            if (!id || !title) throw new Error('Session ID and title are required');

            const updated = sessionManager.renameSession(id, title);

            // If modifying active session, update in-memory ref
            if (session.id === id) {
                session = updated;
            }

            daemon.sendResponse(ws, msgId, {
                success: true,
                sessions: sessionManager.listSessions(),
                replay: exportReplay(updated)
            });
            // Update all connected clients' sidebars
            daemon.broadcast('session:list', { sessions: sessionManager.listSessions() });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('session:compact', (params: any, ws: import('ws').WebSocket, msgId: string) => {
        try {
            const { id } = params;
            if (!id) throw new Error('Session ID is required');

            const updated = sessionManager.compactSession(id);

            // If modifying active session, update in-memory ref
            if (session.id === id) {
                session = updated;
            }

            daemon.sendResponse(ws, msgId, {
                success: true,
                replay: exportReplay(updated)
            });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    // Dashboard RPCs
    daemon.on('blackboard:get', (ws, msgId) => {
        daemon.sendResponse(ws, msgId, session.blackboard);
    });

    daemon.on('model:list', async (ws, msgId) => {
        const providers = await providerResolver.listModelsAsync();
        daemon.sendResponse(ws, msgId, {
            providers,
            defaultModel: providerResolver.getActiveDefault()
        });
    });

    daemon.on('model:switch', (modelId: string, ws, msgId) => {
        try {
            providerResolver.switchModel(modelId);
            console.log(`[Meshy] Web UI switched model to: ${modelId}`);
            daemon.sendResponse(ws, msgId, { success: true, model: modelId });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    // ─── 自定义 Provider 管理 RPC ───

    daemon.on('provider:add', async (params: any, ws: any, msgId: string) => {
        try {
            const { name, protocol, sdk, baseUrl, apiKey, models } = params || {};
            if (!name || typeof name !== 'string') {
                throw new Error('Provider name is required and must be a string.');
            }
            if (config.providers[name]) {
                throw new Error(`Provider "${name}" already exists.`);
            }

            const modelsRecord: Record<string, { name?: string }> = {};
            if (Array.isArray(models)) {
                for (const m of models) {
                    modelsRecord[typeof m === 'string' ? m : m.id] = { name: m.name || m };
                }
            }

            // 更新内存中的 config
            config.providers[name] = {
                protocol: protocol || 'openai',
                sdk: sdk || undefined,
                baseUrl: baseUrl || undefined,
                apiKey: apiKey || '',
                models: Object.keys(modelsRecord).length > 0 ? modelsRecord : undefined,
            };

            // 持久化到 .agent/config.json
            await persistProviderConfig(activeWorkspace.rootPath, (providers) => {
                providers[name] = {
                    protocol: config.providers[name].protocol,
                    ...(sdk ? { sdk } : {}),
                    ...(baseUrl ? { baseUrl } : {}),
                    ...(apiKey ? { apiKey } : {}),
                    ...(Object.keys(modelsRecord).length > 0 ? { models: modelsRecord } : {}),
                };
                return providers;
            });

            // 清除模型缓存，使 model:list 能获取新 provider
            providerResolver.clearModelCache();

            daemon.sendResponse(ws, msgId, { success: true });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('provider:remove', async (params: any, ws: any, msgId: string) => {
        try {
            const { name } = params || {};
            if (!name || typeof name !== 'string') {
                throw new Error('Provider name is required.');
            }
            if (!config.providers[name]) {
                throw new Error(`Provider "${name}" not found.`);
            }

            // 防止删除内置 provider（opencode、local-ernie）
            const builtInProviders = ['opencode', 'local-ernie'];
            if (builtInProviders.includes(name)) {
                throw new Error(`Cannot remove built-in provider "${name}".`);
            }

            // 从内存中删除
            delete config.providers[name];

            // 持久化
            await persistProviderConfig(activeWorkspace.rootPath, (providers) => {
                delete providers[name];
                return providers;
            });

            providerResolver.clearModelCache();

            daemon.sendResponse(ws, msgId, { success: true });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('provider:update', async (params: any, ws: any, msgId: string) => {
        try {
            const { name, protocol, sdk, baseUrl, apiKey, models } = params || {};
            if (!name || typeof name !== 'string') {
                throw new Error('Provider name is required.');
            }
            if (!config.providers[name]) {
                throw new Error(`Provider "${name}" not found.`);
            }

            // 更新内存中的 config（逐字段覆盖）
            const existing = config.providers[name];
            if (protocol !== undefined) existing.protocol = protocol;
            if (sdk !== undefined) existing.sdk = sdk;
            if (baseUrl !== undefined) existing.baseUrl = baseUrl;
            if (apiKey !== undefined) existing.apiKey = apiKey;

            if (Array.isArray(models)) {
                const modelsRecord: Record<string, { name?: string }> = {};
                for (const m of models) {
                    modelsRecord[typeof m === 'string' ? m : m.id] = { name: m.name || m };
                }
                existing.models = Object.keys(modelsRecord).length > 0 ? modelsRecord : undefined;
            }

            // 持久化
            await persistProviderConfig(activeWorkspace.rootPath, (providers) => {
                const target = providers[name] || {};
                if (protocol !== undefined) target.protocol = protocol;
                if (sdk !== undefined) target.sdk = sdk;
                if (baseUrl !== undefined) target.baseUrl = baseUrl;
                if (apiKey !== undefined) target.apiKey = apiKey;
                if (Array.isArray(models)) {
                    const modelsRecord: Record<string, { name?: string }> = {};
                    for (const m of models) {
                        modelsRecord[typeof m === 'string' ? m : m.id] = { name: m.name || m };
                    }
                    target.models = Object.keys(modelsRecord).length > 0 ? modelsRecord : undefined;
                }
                providers[name] = target;
                return providers;
            });

            providerResolver.clearModelCache();

            daemon.sendResponse(ws, msgId, { success: true });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('provider:list', (ws: any, msgId: string) => {
        const customProviders: Array<{
            name: string;
            protocol?: string;
            sdk?: string;
            baseUrl?: string;
            hasApiKey: boolean;
            models: string[];
        }> = [];

        const builtInProviders = ['opencode', 'local-ernie'];
        for (const [name, cfg] of Object.entries(config.providers)) {
            if (builtInProviders.includes(name)) continue;
            const models = cfg.models ? Object.keys(cfg.models) : [];
            customProviders.push({
                name,
                protocol: cfg.protocol,
                sdk: cfg.sdk,
                baseUrl: cfg.baseUrl,
                hasApiKey: !!cfg.apiKey && !cfg.apiKey.startsWith('placeholder'),
                models,
            });
        }

        daemon.sendResponse(ws, msgId, { providers: customProviders });
    });

    daemon.on('agent:list', (ws, msgId) => {
        const subagentRegistry = engine.getSubagentRegistry();
        const agents = subagentRegistry.listAgents().map(a => ({
            id: a.name,
            name: a.name,
            description: a.description,
            emoji: a.emoji
        }));
        daemon.sendResponse(ws, msgId, {
            agents,
            activeAgentId: session.activeAgentId
        });
    });

    daemon.on('agent:switch', (params: { agentId: string }, ws, msgId) => {
        try {
            const { agentId } = params;
            if (!agentId) throw new Error('Agent ID is required');

            // 验证 agent 存在
            const subagentRegistry = engine.getSubagentRegistry();
            if (!subagentRegistry.getAgent(agentId)) {
                throw new Error(`Agent ${agentId} not found`);
            }

            session.activeAgentId = agentId;
            sessionManager.saveSession(session);

            console.log(`[Meshy] Web UI switched agent to: ${agentId}`);
            daemon.sendResponse(ws, msgId, { success: true, agentId });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    let cachedCommands: any[] | null = null;
    daemon.on('command:list', (params: any, ws: any, msgId: string) => {
        if (!cachedCommands) {
            const builtinCommands = [
                { name: 'ask', description: 'Ask without modifying code' },
                { name: 'plan', description: 'Plan mode, output structured steps' },
                { name: 'model', description: 'List providers or switch model' },
                { name: 'session', description: 'Session management' },
                { name: 'workflow', description: 'Workflow management' },
                { name: 'clear', description: 'Clear current session' },
                { name: 'undo', description: 'Roll back last edit' },
                { name: 'test', description: 'Run tests' },
                { name: 'compact', description: 'Compress conversation history' },
                { name: 'feedback', description: 'Thumbs up/down for current session' },
                { name: 'init', description: 'Initialize workspace context (tech-stack, product)' },
                { name: 'help', description: 'Show this help' },
            ];
            const customCommands = (engine as any).customCommands ? (engine as any).customCommands.listCommands() : [];
            cachedCommands = [...builtinCommands, ...customCommands];
        }
        daemon.sendResponse(ws, msgId, {
            commands: cachedCommands
        });
    });

    // Unified @ mention list — aggregates agents, skills, and MCP servers
    daemon.on('mention:list', (_params: any, ws: any, msgId: string) => {
        const items: Array<{ namespace: string; name: string; label: string; description: string; emoji: string }> = [];

        // Agents
        try {
            const agentList = engine.getSubagentRegistry().listAgents();
            for (const a of agentList) {
                items.push({
                    namespace: 'agent',
                    name: a.name,
                    label: a.name,
                    description: a.description,
                    emoji: a.emoji || '🤖',
                });
            }
        } catch (err: any) {
            console.error('[mention:list] agents error:', err.message);
        }

        // Skills (sync scan only — no DB await)
        try {
            const scanned = engine.getSkillRegistry().refreshAll(activeWorkspace.rootPath);
            for (const s of scanned) {
                items.push({
                    namespace: 'skill',
                    name: s.name,
                    label: s.name,
                    description: s.description || '',
                    emoji: '⚡',
                });
            }
        } catch (err: any) {
            console.error('[mention:list] skills error:', err.message);
        }

        // MCP Servers
        try {
            const mcpServers = activeWorkspace.mcpHost.getServerList();
            for (const m of mcpServers) {
                items.push({
                    namespace: 'mcp',
                    name: m.name,
                    label: m.name,
                    description: (m as any).description || (m as any).command || '',
                    emoji: '🔌',
                });
            }
        } catch (err: any) {
            console.error('[mention:list] mcp error:', err.message);
        }

        daemon.sendResponse(ws, msgId, { items });
    });

    daemon.on('skill:list', async (ws, msgId) => {
        try {
            // Serve directly from in-memory registry, initialized at startup
            const skills = engine.getSkillRegistry().listSkills();
            daemon.sendResponse(ws, msgId, { skills });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { skills: [], error: err.message });
        }
    });

    daemon.on('skill:search', async (params: any, ws, msgId) => {
        try {
            const skills = searchSkillsWithBias(
                params.query || '',
                engine.getSkillRegistry(),
                pluginAdapter,
            );
            daemon.sendResponse(ws, msgId, { skills });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { skills: [], error: err.message });
        }
    });

    daemon.on('skill:refresh', async (ws, msgId) => {
        try {
            await activeWorkspace.memoryStore.initialize();
            const scanned = engine.getSkillRegistry().refreshAll(activeWorkspace.rootPath);
            await activeWorkspace.memoryStore.syncSkills(scanned);
            const skills = await activeWorkspace.memoryStore.getAllSkills();
            daemon.sendResponse(ws, msgId, { skills, refreshed: true });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { skills: [], error: err.message });
        }
    });

    daemon.on('skill:read', async (params: any, ws, msgId) => {
        try {
            const filePath = params.filePath;
            if (!filePath) {
                return daemon.sendResponse(ws, msgId, { success: false, error: 'filePath is required' });
            }
            const content = await fs.promises.readFile(filePath, 'utf-8');
            daemon.sendResponse(ws, msgId, { success: true, content });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('skill:write', async (params: any, ws, msgId) => {
        try {
            const { filePath, content } = params;
            if (!filePath || typeof content !== 'string') {
                return daemon.sendResponse(ws, msgId, { success: false, error: 'filePath and content are required' });
            }
            // Write to file
            await fs.promises.writeFile(filePath, content, 'utf-8');

            // Force refresh registry & db to keep metadata in sync
            const scanned = engine.getSkillRegistry().refreshAll(activeWorkspace.rootPath);
            await activeWorkspace.memoryStore.syncSkills(scanned);

            daemon.sendResponse(ws, msgId, { success: true });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('skill:delete', async (params: any, ws, msgId) => {
        try {
            const { filePath } = params;
            if (!filePath) {
                return daemon.sendResponse(ws, msgId, { success: false, error: 'filePath is required' });
            }

            // Skill is a directory containing SKILL.md
            const skillDir = path.dirname(filePath);
            await fs.promises.rm(skillDir, { recursive: true, force: true });

            // Force refresh registry & db to keep metadata in sync
            const scanned = engine.getSkillRegistry().refreshAll(activeWorkspace.rootPath);
            await activeWorkspace.memoryStore.syncSkills(scanned);

            daemon.sendResponse(ws, msgId, { success: true });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('mcp:list', (ws, msgId) => {
        daemon.sendResponse(ws, msgId, {
            servers: activeWorkspace.mcpHost.getServerList(),
        });
    });

    daemon.on('mcp:create', (params: any, ws, msgId) => {
        try {
            activeWorkspace.mcpHost.addServer(params.config);
            daemon.sendResponse(ws, msgId, {
                success: true,
                servers: activeWorkspace.mcpHost.getServerList(),
            });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('mcp:update', (params: any, ws, msgId) => {
        try {
            activeWorkspace.mcpHost.updateServer(params.name, params.config);
            daemon.sendResponse(ws, msgId, {
                success: true,
                servers: activeWorkspace.mcpHost.getServerList(),
            });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('mcp:delete', (params: any, ws, msgId) => {
        try {
            activeWorkspace.mcpHost.removeServer(params.name);
            daemon.sendResponse(ws, msgId, {
                success: true,
                servers: activeWorkspace.mcpHost.getServerList(),
            });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('mcp:toggle', async (params: any, ws, msgId) => {
        try {
            await activeWorkspace.mcpHost.toggleServer(params.name, params.enabled);
            daemon.sendResponse(ws, msgId, {
                success: true,
                servers: activeWorkspace.mcpHost.getServerList(),
            });
        } catch (err: any) {
            daemon.sendResponse(ws, msgId, { success: false, error: err.message });
        }
    });

    daemon.on('ritual:status', (ws, msgId) => {
        daemon.sendResponse(ws, msgId, {
            rituals: [
                { name: 'SOUL.md', status: 'Loaded', desc: 'Agent identity and behavioral rules' },
                { name: 'HEARTBEAT.md', status: 'Pending', desc: 'Self-verification ritual checkpoint' },
                { name: 'BOOTSTRAP.md', status: 'Not Found', desc: 'Session initialization script' }
            ]
        });
    });

    daemon.on('capsules:list', async (ws, msgId) => {
        try {
            const capsules = await activeWorkspace.memoryStore.getRecentCapsules(20);
            daemon.sendResponse(ws, msgId, capsules);
        } catch (err) {
            daemon.sendResponse(ws, msgId, { error: 'Failed to fetch capsules' });
        }
    });

    daemon.on('session:replay', (sessionId: string, ws, msgId) => {
        if (session.id === sessionId) {
            daemon.sendResponse(ws, msgId, exportReplay(session));
        } else {
            // We use activeWorkspace instead of process.cwd() fallback since we hot-swap
            let replayPath = `${activeWorkspace.rootPath}/.meshy/sessions/${sessionId}.jsonl`;
            let isJsonl = true;
            if (!require('fs').existsSync(replayPath)) {
                replayPath = `${activeWorkspace.rootPath}/.meshy/sessions/${sessionId}.json`;
                isJsonl = false;
            }

            if (require('fs').existsSync(replayPath)) {
                try {
                    const data = require('fs').readFileSync(replayPath, 'utf-8');
                    const loaded = import('./core/session/state.js').then(m => m.Session.deserialize(data));
                    // Quick hack: we'd need top-level await for actual deserialization, but since this is just replay
                    // We let SessionManager load it 
                    const tmpSession = sessionManager.loadSession(sessionId);
                    if (tmpSession) {
                        daemon.sendResponse(ws, msgId, exportReplay(tmpSession));
                    } else {
                        daemon.sendResponse(ws, msgId, { error: 'Replay not found or corrupt' });
                    }
                } catch (e) {
                    daemon.sendResponse(ws, msgId, { error: 'Replay load error' });
                }
            } else {
                // older replay formats 
                const oldReplay = `${activeWorkspace.rootPath}/.meshy/replays/${sessionId}.replay.json`;
                const replay = loadReplay(oldReplay);
                if (replay) {
                    daemon.sendResponse(ws, msgId, replay);
                } else {
                    daemon.sendResponse(ws, msgId, { error: 'Replay not found' });
                }
            }
        }
    });

    // 进程退出时清理本地小模型资源
    const cleanup = () => {
        console.log('\n[Meshy] Shutting down server, cleaning up local models...');
        engine.shutdown();
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    console.log(`\n[Meshy] Server mode active. Waiting for connections on port ${port}...`);
    console.log(`[Meshy] Open http://localhost:${port} in your browser.`);
    // 保持进程活跃，不退出
}

/**
 * 简单的 CLI 提问助手
 */
function promptUser(question: string): Promise<string> {
    return new Promise((resolve) => {
        process.stdout.write(question);
        process.stdin.resume();
        const onData = (data: Buffer) => {
            process.stdin.removeListener('data', onData);
            process.stdin.pause();
            resolve(data.toString().trim());
        };
        process.stdin.once('data', onData);
    });
}

function printUsage(): void {
    console.log(`
Meshy — Advanced Multi-Agent AI Framework

Usage:
  meshy [prompt]                      交互式 REPL (无参数) 或一次性执行 (有参数)
  meshy server [--port 9120]         启动 Web Dashboard + WebSocket 守护进程
  meshy -p "prompt"                  一次性执行任务
  meshy run "prompt"                 一次性执行任务 (OpenCode 风格)

Options:
  -p, --print <prompt>    指定要执行的 Prompt (一次性模式)
  -m, --model <model>     指定模型 (e.g. zeabur/gpt-4o, openai/o3-mini)
  -f, --file <path>       指定要附带的文件 (未来版本)
  -y, --yes               自动确认所有操作 (YOLO 模式, 跳过审批)
  --port <number>         Web Server 端口 (默认 9120)
  --daemon                启动 Web Server (兼容旧写法, 等同于 server)

REPL Commands:
  /exit, /quit            退出交互式模式
  /help                   显示此帮助
  /clear                  清空当前会话上下文
  /model <name>           切换模型 (e.g. /model zeabur/gpt-4o)

Examples:
  meshy                   进入交互式 REPL
  meshy server
  meshy -p "Hello, are you ready?"
  meshy -m zeabur/gpt-4o "解释这段代码"
  meshy run -m openai/o3-mini "生成一个快速排序"
  cat main.go | meshy -p "优化这段代码"
`);
}

// ─── 交互式 REPL ───

/**
 * 交互式 REPL：一问一答，持续对话，如 OpenCode 之风。
 */
async function runRepl(options?: { model?: string | null }) {
    const config = loadConfig();
    const providerNames = Object.keys(config.providers);
    console.log(`[Meshy] REPL mode. Providers: [${providerNames.join(', ')}] | Default: ${config.models.default}`);
    if (options?.model) console.log(`[Meshy] Model override: ${options.model}`);

    const { ProviderResolver } = await import('./core/llm/resolver.js');
    const providerResolver = new ProviderResolver(config);
    if (options?.model) providerResolver.switchModel(options.model);

    const workspaceManager = new WorkspaceManager(providerResolver);
    const activeWorkspace = workspaceManager.getWorkspace(process.cwd());
    const sessionManager = new SessionManager(activeWorkspace.rootPath);
    const session = sessionManager.createSession();

    const engine = new TaskEngine(providerResolver, activeWorkspace, session, {
        maxRetries: config.system.maxRetries,
        executionMode: 'yolo' as any,
    });
    engine.getSkillRegistry().scan(activeWorkspace.rootPath);

    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '\n>>> ',
    });

    // 抑制引擎内部 daemon broadcast 调用（REPL 模式无 daemon）
    const origBroadcast = (engine as any).daemon?.broadcast;
    if ((engine as any).daemon) {
        (engine as any).daemon.broadcast = () => {};
    }

    console.log(`\n${'─'.repeat(48)}`);
    console.log('  REPL 交互式模式  输入 /exit 退出  /help 帮助');
    console.log(`${'─'.repeat(48)}`);

    rl.prompt();

    rl.on('line', async (line: string) => {
        const input = line.trim();

        if (!input) {
            rl.prompt();
            return;
        }

        // 处理 REPL 内部命令
        if (input.startsWith('/')) {
            const parts = input.slice(1).split(/\s+/);
            const cmd = parts[0].toLowerCase();

            switch (cmd) {
                case 'exit':
                case 'quit':
                    console.log('[Meshy] 再见。');
                    engine.shutdown();
                    rl.close();
                    process.exit(0);
                    return;

                case 'help':
                    console.log(`
REPL 命令:
  /exit, /quit    退出
  /help           显示此帮助
  /clear          清空当前会话上下文
  /model <name>   切换模型
                        `);
                    rl.prompt();
                    return;

                case 'clear':
                    engine.setSession(sessionManager.createSession());
                    console.log('[Meshy] 会话已清空。');
                    rl.prompt();
                    return;

                case 'model':
                    if (parts[1]) {
                        try {
                            providerResolver.switchModel(parts[1]);
                            console.log(`[Meshy] 已切换至: ${parts[1]}`);
                        } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : String(err);
                            console.log(`[Meshy] 切换失败: ${msg}`);
                        }
                    } else {
                        console.log('[Meshy] 用法: /model <providerName/modelId>');
                    }
                    rl.prompt();
                    return;

                default:
                    console.log(`[Meshy] 未知命令: /${cmd}。输入 /help 查看可用命令。`);
                    rl.prompt();
                    return;
            }
        }

        // 执行任务
        try {
            await engine.runTask(input);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`\n[Error] ${msg}`);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        engine.shutdown();
        process.exit(0);
    });
}

// ─── CLI 入口 ───
const isMainModule = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.mjs');

if (isMainModule) {
    const parsed = parseArgs(process.argv);

    switch (parsed.subcommand) {
        case 'server':
            runServer(parsed.port).catch(console.error);
            break;

        case 'run': {
            // 支持 pipe 模式: cat file | meshy -p "prompt"
            readStdin().then((stdinData) => {
                let finalPrompt = parsed.prompt;
                if (stdinData) {
                    finalPrompt = stdinData + (finalPrompt ? `\n\nUser instruction: ${finalPrompt}` : '');
                }
                if (!finalPrompt) {
                    console.error('[Meshy] Error: No prompt provided.');
                    printUsage();
                    process.exit(1);
                }
                return runMeshy(finalPrompt, { model: parsed.model, autoConfirm: parsed.autoConfirm });
            }).catch(console.error);
            break;
        }

        case 'interactive':
            runRepl({ model: parsed.model }).catch((err) => {
                console.error('[Meshy] REPL error:', err);
                process.exit(1);
            });
            break;

        default:
            printUsage();
            break;
    }
}

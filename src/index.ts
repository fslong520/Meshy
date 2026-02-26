import { loadConfig } from './config/index.js';
import { OpenAIAdapter } from './core/llm/openai.js';
import { AnthropicAdapter } from './core/llm/anthropic.js';
import { Session } from './core/session/state.js';
import { TaskEngine } from './core/engine/index.js';
import { ILLMProvider } from './core/llm/provider.js';
import { DaemonServer } from './core/daemon/server.js';
import { WorkspaceManager } from './core/workspace/manager.js';
import { SessionManager } from './core/session/manager.js';

export async function runMeshy(prompt: string) {
    // 1. Load configuration
    const config = loadConfig();
    const providerNames = Object.keys(config.providers);
    console.log(`[Meshy] Loaded Config. Providers: [${providerNames.join(', ')}] | Default: ${config.models.default}`);

    // 2. Initialize the Provider Resolver
    const { ProviderResolver } = await import('./core/llm/resolver.js');
    const providerResolver = new ProviderResolver(config);

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
        // Try to list existing sessions to offer resume if not explicitly in a crash state
        const history = sessionManager.listSessions();
        if (history.length > 0 && !prompt) { // Only if no direct prompt provided
            console.log('[Meshy] Recent sessions:');
            history.slice(0, 5).forEach((s, i) => console.log(`  ${i + 1}. ${s.id} (${s.lastModified.toLocaleString()})`));
        }
        session = sessionManager.createSession();
    }

    // 4. Start Daemon Server optionally (Phase 5)
    const isDaemonMode = process.argv.includes('--daemon');
    let daemon: DaemonServer | undefined;
    if (isDaemonMode) {
        daemon = new DaemonServer(9120);
        daemon.start();

        // 监听 Web UI 发来的独立任务
        daemon.on('task:submit', async (submittedPrompt: string, id?: string) => {
            console.log(`\n[Meshy] Received task from Web UI: ${submittedPrompt}`);
            try {
                await engine.runTask(submittedPrompt);
                daemon?.broadcast('agent:done', { id });
            } catch (err) {
                console.error('[Meshy] Task from Web UI failed:', err);
            }
        });

        daemon.on('workspace:list', (ws, msgId) => {
            daemon?.sendResponse(ws, msgId, {
                workspaces: workspaceManager.listWorkspaces()
            });
        });

        daemon.on('session:list', (ws, msgId) => {
            daemon?.sendResponse(ws, msgId, {
                sessions: sessionManager.listSessions()
            });
        });

        daemon.on('session:switch', async (sessionId: string, ws, msgId) => {
            const newSession = sessionManager.loadSession(sessionId);
            if (newSession) {
                // In a real multi-session engine, we might swap the engine's session
                // For now, we update the active engine's session or notify result
                daemon?.sendResponse(ws, msgId, { success: true, sessionId });
            } else {
                daemon?.sendResponse(ws, msgId, { success: false, error: 'Session not found' });
            }
        });
    }

    // 5. Start Task Engine
    const engine = new TaskEngine(providerResolver, activeWorkspace, session, {
        maxRetries: config.system.maxRetries,
        daemon: daemon,
    });

    if (isResuming) {
        console.log(`[Meshy] Resuming task...`);
        await engine.resumeTask();
    } else {
        console.log(`[Meshy] Starting task...`);
        await engine.runTask(prompt);
    }

    // 处理退出逻辑
    if (isDaemonMode) {
        console.log(`\n[Meshy] CLI Task completed or suspended. Daemon is still running for Web UI.`);
    } else {
        console.log(`\n[Meshy] Task completed. Exiting.`);
        process.exit(0);
    }
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

// CLI entry point stub
const isMainModule = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMainModule) {
    const userPrompt = process.argv.slice(2).join(' ') || 'Hello, are you ready?';
    runMeshy(userPrompt).catch(console.error);
}

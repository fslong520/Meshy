import { loadConfig } from './config/index.js';
import { OpenAIAdapter } from './core/llm/openai.js';
import { AnthropicAdapter } from './core/llm/anthropic.js';
import { Session } from './core/session/state.js';
import { TaskEngine } from './core/engine/index.js';
import { ILLMProvider } from './core/llm/provider.js';
import { DaemonServer } from './core/daemon/server.js';
import { SnapshotManager } from './core/session/snapshot.js';

export async function runMeshy(prompt: string) {
    // 1. Load configuration
    const config = loadConfig();
    console.log(`[Meshy] Loaded Config. Provider: ${config.provider}`);

    // 2. Initialize the Provider Resolver
    const { ProviderResolver } = await import('./core/llm/resolver.js');
    const providerResolver = new ProviderResolver(config);

    // 3. Initialize Session & Blackboard
    let session: Session;
    let isResuming = false;

    // Phase 5: Crash Recovery
    const snapshotManager = new SnapshotManager(process.cwd());
    const latestCrashedSession = snapshotManager.loadLatestSession();

    if (latestCrashedSession) {
        const answer = await promptUser(`[Meshy] Detected an interrupted session (${latestCrashedSession.id}). Do you want to resume it? [y/N]: `);
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            session = latestCrashedSession;
            isResuming = true;
        } else {
            console.log(`[Meshy] Discarding interrupted session.`);
            snapshotManager.clearSnapshot(latestCrashedSession.id);
            session = new Session('session-' + Date.now());
        }
    } else {
        session = new Session('session-' + Date.now());
    }

    // 4. Start Daemon Server (Phase 5)
    const daemon = new DaemonServer(9120);
    daemon.start();

    // 5. Start Task Engine
    const engine = new TaskEngine(providerResolver, session, {
        maxRetries: config.system.maxRetries,
        daemon: daemon,
    });

    // 监听 Web UI 发来的独立任务（如果在守护进程模式下使用）
    daemon.on('task:submit', async (submittedPrompt: string, id?: string) => {
        console.log(`\n[Meshy] Received task from Web UI: ${submittedPrompt}`);
        try {
            await engine.runTask(submittedPrompt);
            daemon.broadcast('agent:done', { id });
        } catch (err) {
            console.error('[Meshy] Task from Web UI failed:', err);
        }
    });

    if (isResuming) {
        console.log(`[Meshy] Resuming task...`);
        await engine.resumeTask();
    } else {
        console.log(`[Meshy] Starting task...`);
        await engine.runTask(prompt);
    }

    // 如果没有通过 CLI 传入任何任务，或者任务结束，可以考虑保持进程不退出，以服务 Web UI。
    // 为了防止 CLI 立即退出，我们这里不需要手动 stop daemon。
    console.log(`\n[Meshy] CLI Task completed or suspended. Daemon is still running for Web UI.`);
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

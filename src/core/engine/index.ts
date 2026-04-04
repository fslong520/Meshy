import { ILLMProvider, StandardPrompt } from '../llm/provider.js';
import { ProviderResolver } from '../llm/resolver.js';
import { AgentComputerInterface } from '../aci/index.js';
import { Session } from '../session/state.js';
import { ToolOutputOffloader } from './offloader.js';
import { ProgressTracker } from '../session/progress.js';
import { IntentRouter } from '../router/intent.js';
import { InputParser, ParsedInput } from '../router/input-parser.js';
import { SystemPromptBuilder } from '../router/prompt-builder.js';
import { SkillRegistry } from '../skills/registry.js';
import { SubagentRegistry } from '../subagents/loader.js';
import { LazyInjector } from '../injector/lazy.js';
import { ExecutionSandbox, ExecutionMode, AskUserCallback } from '../sandbox/execution.js';
import { AISecondaryReviewer } from '../sandbox/reviewer.js';
import { LSPManager } from '../lsp/index.js';
import { DaemonServer } from '../daemon/server.js';
import { MemoryStore } from '../memory/store.js';
import { ReflectionEngine, FeedbackType } from '../memory/reflection.js';
import { ToolRegistry, createDefaultRegistry, defineTool } from '../tool/index.js';
import { createDefaultToolPackRegistry } from '../tool/tool-pack.js';
import { z } from 'zod';
import { loadConfig } from '../../config/index.js';
import { executeDelegate } from '../tool/delegate-tool.js';
import { Workspace } from '../workspace/workspace.js';
import { WorkerAgent } from './worker.js';
import { SecurityGuard } from '../security/guard.js';
import { ExecutionMode as SecurityExecutionMode } from '../security/modes.js';
import { SessionManager } from '../session/manager.js';
import { WorkflowEngine, loadWorkflows } from '../workflow/engine.js';
import { Logger, initLogger, getLogger } from '../logger/index.js';
import { createTodoWriteTool, createTodoReadTool } from '../tool/todo.js';
import { CompactionAgent } from '../session/compaction.js';
import { CustomCommandRegistry } from '../commands/loader.js';
import { RitualLoader } from '../ritual/loader.js';
import { exportReplay, saveReplay, formatReplayText } from '../session/replay.js';
import { SessionHealthInspector } from '../session/health-check.js';
import { normalizeAgentMessageEvent } from '../runtime/protocol.js';

export interface EngineOptions {
    maxRetries?: number;
    executionMode?: ExecutionMode;
    askUser?: AskUserCallback;
    daemon?: DaemonServer;
}

const BASE_SYSTEM_PROMPT = `You are Meshy, the best local-first coding agent.

You are an interactive agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user. Keep going until the user's query is completely resolved before yielding back.

## Core Mandates
- Rigorously adhere to existing project conventions when reading or modifying code. Analyze surrounding code, tests, and configuration first.
- NEVER assume a library or framework is available. Verify its usage within the project (check imports, package.json, tsconfig.json, etc.) before employing it.
- Mimic the style (formatting, naming), structure, framework choices, and architectural patterns of existing code.
- When editing, understand the local context (imports, functions, classes) to ensure changes integrate naturally and idiomatically.
- Add code comments sparingly. Focus on *why* something is done, not *what*. NEVER use comments to communicate with the user.

## Editing Constraints
- Default to ASCII when editing or creating files. Only introduce non-ASCII characters when the file already uses them.
- ALWAYS prefer editing an existing file over creating a new one.
- Before editing, always read the relevant file content to ensure complete context. Do not guess file contents.
- Make small, testable, incremental changes that logically follow from the plan.

## Tool Usage Policy
- Prefer specialized tools over shell for file operations:
  - Use 'readFile' to view files instead of cat/head/tail.
  - Use 'editFile' or 'write' to modify or create files instead of sed/awk/echo redirection.
  - Use 'glob' and 'grep' to find files by name and search contents.
- Use 'runCommand' for terminal operations (git, npm, builds, tests, scripts).
- Run tool calls in parallel when neither call depends on the other's output; otherwise run sequentially.
- NEVER use bash echo or command-line tools as means to communicate with the user. Output all communication directly in your response text.
- Code MUST be saved to physical files via tools. DO NOT output massive code blocks in chat unless the code has already been written to a file.

## Git and Workspace Hygiene
- You may be in a dirty git worktree.
  * NEVER revert existing changes you did not make unless explicitly requested.
  * If asked to commit and there are unrelated changes in those files, do not revert them.
  * If changes are in files you've touched recently, read carefully and work with them rather than reverting.
  * If changes are in unrelated files, ignore them.
- Do not amend commits unless explicitly requested.
- **NEVER** use destructive commands like \`git reset --hard\` or \`git checkout -- .\` unless specifically approved by the user.
- You are NEVER allowed to stage and commit automatically unless the user tells you to.

## Autonomous Decision Making
- Default: do the work without asking unnecessary questions. Treat short tasks as sufficient direction; infer missing details by reading the codebase and following existing conventions.
- Questions: only ask when you are truly blocked AND you cannot safely pick a reasonable default. This usually means:
  * The request is ambiguous in a way that materially changes the result.
  * The action is destructive, irreversible, or changes security posture.
  * You need a secret/credential/value that cannot be inferred.
- If you must ask: do all non-blocked work first, then ask exactly one targeted question. Include your recommended default and state what would change based on the answer.
- Never ask permission questions like "Should I proceed?" or "Do you want me to run tests?". Proceed with the most reasonable option and mention what you did.

## Professional Objectivity
Prioritize technical accuracy over validating the user's beliefs. Focus on facts and problem-solving, providing direct, objective technical info without unnecessary praise. Respectful correction is more valuable than false agreement. When uncertain, investigate first rather than instinctively confirming.

## Frontend Tasks
When doing frontend design tasks, avoid collapsing into bland, generic layouts. Aim for interfaces that feel intentional and deliberate:
- Typography: Use expressive, purposeful fonts. Avoid bland defaults (Arial, system-ui) unless the project already uses them.
- Color & Look: Choose a clear visual direction; define CSS variables. No purple bias or dark mode bias unless requested.
- Motion: Use a few meaningful animations (page-load, staggered reveals) instead of generic micro-motions.
- Background: Don't rely on flat, single-color backgrounds; use gradients, shapes, or subtle patterns.
- Overall: Avoid boilerplate layouts and interchangeable UI patterns.
- Exception: If working within an existing design system, preserve established patterns.

## Presenting Your Work
- Be very concise; friendly coding teammate tone.
- For code changes: lead with a quick explanation of the change, then give context on where and why.
- Don't dump large files you've written; reference file paths only.
- Reference files using inline code to make paths identifiable: \`src/app.ts:42\`.
- Offer logical next steps (tests, commits, build) briefly; add verify steps if you couldn't do something.
- When suggesting multiple options, use numeric lists so the user can quickly respond with a number.
- Skip heavy formatting for simple confirmations.
- Use GitHub-flavored Markdown for formatting.`;

export class TaskEngine {
    private providerResolver: ProviderResolver;
    public workspace: Workspace;
    private aci: AgentComputerInterface;
    private session: Session;
    private maxRetries: number;

    // Phase 2 组件
    private router: IntentRouter;
    private skillRegistry: SkillRegistry;

    /** 暴露 SkillRegistry 供外部 RPC 调用。 */
    public getSkillRegistry(): SkillRegistry {
        return this.skillRegistry;
    }
    private subagentRegistry: SubagentRegistry;

    /** 暴露 SubagentRegistry 供外部 RPC 调用。 */
    public getSubagentRegistry(): SubagentRegistry {
        return this.subagentRegistry;
    }

    /** 暴露 ToolRegistry 供外部 RPC 调用。 */
    public getToolRegistry(): ToolRegistry {
        return this.toolRegistry;
    }
    private injector: LazyInjector;

    // Phase 3 组件
    private sandbox: ExecutionSandbox;
    private daemon?: DaemonServer;

    // Phase 12: Session Manager
    private sessionManager: SessionManager;

    // Phase 7 Circuit Breaker
    private editAutoFixRetries: Map<string, number> = new Map();
    private MAX_AUTOFIX_RETRIES = 3;

    // Tool System
    private toolRegistry: ToolRegistry;

    // Phase 14: Structured Logger
    public logger: Logger;

    // Phase 14: Compaction Agent
    private compactionAgent: CompactionAgent;
    private abortController: AbortController | null = null;
    public isRunning: boolean = false;

    // Phase 20: Tool Output Offloader
    private offloader: ToolOutputOffloader;

    // Phase 20: Progress Tracker & Session Health
    private progressTracker: ProgressTracker;
    private healthInspector: typeof import('../session/health-check.js').SessionHealthInspector['prototype'];

    // Phase 15: Custom Commands
    private customCommands: CustomCommandRegistry;

    // Phase 16: Ritual Files
    private ritualLoader: RitualLoader;

    constructor(providerResolver: ProviderResolver, workspace: Workspace, session: Session, options: EngineOptions = {}) {
        this.providerResolver = providerResolver;
        this.workspace = workspace;
        this.session = session;
        this.aci = new AgentComputerInterface();

        const config = loadConfig();
        this.maxRetries = options.maxRetries || config.system.maxRetries || 3;

        // Phase 2 init
        this.router = new IntentRouter(this.providerResolver);
        this.skillRegistry = new SkillRegistry();
        this.skillRegistry.scan(workspace.rootPath);
        this.subagentRegistry = new SubagentRegistry();
        this.toolRegistry = createDefaultRegistry();

        const toolPackRegistry = createDefaultToolPackRegistry();
        this.injector = new LazyInjector(this.skillRegistry, this.subagentRegistry, this.toolRegistry, toolPackRegistry);
        this.subagentRegistry.scan();

        // Phase 15: Custom Commands
        this.customCommands = new CustomCommandRegistry(workspace.rootPath);
        this.customCommands.scan();

        // Phase 16: Ritual Files
        this.ritualLoader = new RitualLoader(workspace.rootPath);
        if (config.system.enableRituals) {
            this.ritualLoader.load();
        }

        // Phase 3 init
        this.daemon = options.daemon;
        const askUser: AskUserCallback = options.askUser
            ?? (this.daemon ? this.daemon.requestApproval.bind(this.daemon) : this.defaultAskUser);
        const reviewer = new AISecondaryReviewer(this.providerResolver);
        this.sandbox = new ExecutionSandbox(options.executionMode || 'smart', askUser, reviewer);

        // Tool System init: 注册内置工具 + ACI 工具
        this.toolRegistry = createDefaultRegistry();
        this.registerAciTools();

        // Phase 12: Session Manager
        this.sessionManager = new SessionManager(
            workspace.rootPath,
            workspace.snapshotManager,
            workspace.reflectionEngine,
        );

        // Phase 14: Logger
        this.logger = initLogger({
            minLevel: 'DEBUG',
            workspaceRoot: workspace.rootPath,
            sessionId: session.id,
        });

        // Phase 14: Compaction Agent
        this.compactionAgent = new CompactionAgent(this.providerResolver.getProvider());

        // Phase 20: Tool Output Offloader
        this.offloader = new ToolOutputOffloader(workspace.rootPath);
        this.offloader.cleanup(); // Clean up stale tool output files on startup

        // Phase 20: Progress Tracker
        this.progressTracker = new ProgressTracker(workspace.rootPath);

        // Phase 20: Session Health Inspector
        this.healthInspector = new SessionHealthInspector(workspace.rootPath);
    }

    /**
     * Runtime session hot-swapping (e.g. from Web UI).
     * Re-initializes the logger context for the new session id.
     */
    public setSession(session: import('../session/state.js').Session): void {
        this.session = session;
        this.logger = getLogger() || initLogger({
            minLevel: 'DEBUG',
            workspaceRoot: this.workspace.rootPath,
            sessionId: session.id,
        });
        console.log(`[Engine] Switched active context to session: ${session.id}`);
    }

    private addMessageAndAppend(msg: any): void {
        this.session.addMessage(msg);
        this.workspace.snapshotManager.appendMessage(this.session, msg);
    }

    private defaultAskUser(question: string): Promise<string> {
        return new Promise((resolve) => {
            process.stdout.write(`\n${question}\n> `);
            process.stdin.resume();
            process.stdin.once('data', (data) => resolve(data.toString().trim()));
        });
    }

    /**
     * 处理 slash 命令（/ask, /plan, /undo, /clear 等）。
     * 这些命令不走 LLM 流程，直接在本地系统层面执行。
     */
    private async handleSlashCommand(
        command: import('../router/input-parser.js').SlashCommand,
        parsed: ParsedInput,
    ): Promise<void> {
        let systemOutput = '';
        switch (command.type) {
            case 'clear':
                this.session.clear();
                systemOutput = '[Slash] Session cleared.';
                this.daemon?.broadcast('agent:session_changed', { sessionId: this.session.id });
                break;

            case 'undo':
                systemOutput = '[Slash] Undo requested — rolling back last edit via ACI.';
                // 未来可对接 git checkout / ACI 层回滚
                break;

            case 'help':
                const helpLines = [
                    'Available commands:',
                    '  /ask <question>   — Ask without modifying code',
                    '  /plan <task>      — Plan mode, output structured steps',
                    '  /model [target]   — List providers or switch model (e.g. /model zeabur/gpt-5.2)',
                    '  /session <cmd>    — Session management (list / save / load <id> / archive)',
                    '  /workflow <cmd>   — Workflow management (list / run <name>)',
                    '  /clear            — Clear current session',
                    '  /undo             — Roll back last edit',
                    '  /test             — Run tests',
                    '  /feedback <+|->   — Thumbs up/down for current session (triggers reflection)',
                    '  /doctor           — Run system diagnostics (Node, Git, DB, etc.)',
                    '  /help             — Show this help',
                ];
                // Phase 15: 列出自定义命令
                const customCmds = this.customCommands.listCommands();
                if (customCmds.length > 0) {
                    helpLines.push('\nCustom commands (.meshy/commands/):');
                    for (const cmd of customCmds) {
                        helpLines.push(`  /${cmd.name.padEnd(16)} — ${cmd.description || '(no description)'}`);
                    }
                }
                systemOutput = helpLines.join('\n');
                break;

            case 'model': {
                if (!command.args) {
                    // 列出所有可用 provider 和当前模型
                    const providers = this.providerResolver.listProviders();
                    const currentModel = this.providerResolver.getActiveDefault();
                    const outLines = [];
                    outLines.push('\n  Current model: ' + currentModel);
                    outLines.push('  Available providers:');
                    for (const p of providers) {
                        const url = p.baseUrl ? ` (${p.baseUrl})` : ' (official)';
                        outLines.push(`    • ${p.name} [${p.protocol}]${url}`);
                    }
                    outLines.push('\n  Usage: /model <providerName/modelId>');
                    systemOutput = outLines.join('\n');
                } else {
                    try {
                        this.providerResolver.switchModel(command.args.trim());
                        systemOutput = `[Model] Switched to: ${command.args.trim()}`;
                    } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        systemOutput = `[Model] Failed to switch: ${msg}`;
                    }
                }
                break;
            }

            case 'session': {
                const subCmd = (command.args || '').trim().split(/\s+/);
                const action = subCmd[0] || 'list';

                switch (action) {
                    case 'list': {
                        const sessions = this.sessionManager.listSessions();
                        if (sessions.length === 0) {
                            systemOutput = '[Session] No sessions found.';
                        } else {
                            const outLines = ['\n  Sessions:'];
                            for (const s of sessions) {
                                const goalLabel = s.goal ? ` — ${s.goal}` : '';
                                outLines.push(`    • [${s.status.toUpperCase()}] ${s.id} (${s.messageCount} msgs, ${s.updatedAt})${goalLabel}`);
                            }
                            systemOutput = outLines.join('\n');
                        }
                        break;
                    }
                    case 'save':
                        this.sessionManager.suspendSession(this.session);
                        systemOutput = `[Session] Current session "${this.session.id}" has been suspended.`;
                        break;
                    case 'load': {
                        const targetId = subCmd[1];
                        if (!targetId) {
                            systemOutput = '[Session] Usage: /session load <session-id>';
                            break;
                        }
                        const restored = this.sessionManager.resumeSession(targetId);
                        if (restored) {
                            this.session = restored;
                            systemOutput = `[Session] Switched to session "${restored.id}".`;
                            this.daemon?.broadcast('agent:session_changed', { sessionId: this.session.id });
                        } else {
                            systemOutput = `[Session] Session "${targetId}" not found.`;
                        }
                        break;
                    }
                    case 'archive': {
                        const targetId = subCmd[1];
                        if (!targetId) {
                            systemOutput = '[Session] Usage: /session archive <session-id>';
                            break;
                        }
                        const sToArchive = this.sessionManager.loadSession(targetId);
                        if (sToArchive) {
                            await this.sessionManager.archiveSession(sToArchive);
                            systemOutput = `[Session] Session "${targetId}" archived.`;
                        } else {
                            systemOutput = `[Session] Session "${targetId}" not found.`;
                        }
                        if (targetId === this.session.id) {
                            // If the current session is archived, broadcast a change
                            this.daemon?.broadcast('agent:session_changed', { sessionId: 'archived' }); // Or some other indicator
                        }
                        break;
                    }
                    case 'replay': {
                        const replay = exportReplay(this.session);
                        const filePath = saveReplay(replay, this.workspace.rootPath);
                        systemOutput = formatReplayText(replay);
                        systemOutput += `\n[Session] Replay saved to: ${filePath}`;
                        break;
                    }
                    default:
                        systemOutput = `[Session] Unknown action "${action}". Use: list, save, load <id>, archive, replay`;
                }
                break;
            }

            case 'test':
                systemOutput = '[Slash] Running workspace tests via ACI...';
                try {
                    const testOut = await this.aci.terminalManager.executeCommand('npm test', 30000);
                    systemOutput += '\n\n' + testOut;
                } catch (e: any) {
                    systemOutput += `\n\n[Error] ${e.message}`;
                }
                break;

            case 'doctor': {
                systemOutput = '[Slash] Running Meshy Doctor...\n';
                try {
                    const os = require('os');
                    const fs = require('fs');
                    const path = require('path');

                    systemOutput += `\n[Environment]`;
                    systemOutput += `\n- OS: ${os.type()} ${os.release()} (${os.arch()})`;
                    systemOutput += `\n- Node.js: ${process.version}`;

                    systemOutput += `\n\n[Workspace]`;
                    systemOutput += `\n- Path: ${this.workspace.rootPath}`;
                    const hasGit = fs.existsSync(path.join(this.workspace.rootPath, '.git'));
                    systemOutput += `\n- Git Repository: ${hasGit ? 'YES' : 'NO'}`;

                    const pjsonPath = path.join(this.workspace.rootPath, 'package.json');
                    if (fs.existsSync(pjsonPath)) {
                        const pjson = JSON.parse(fs.readFileSync(pjsonPath, 'utf8'));
                        const hasVitest = pjson.devDependencies?.vitest || pjson.dependencies?.vitest;
                        systemOutput += `\n- Vitest Installed: ${hasVitest ? 'YES' : 'NO'}`;
                    }

                    systemOutput += `\n\n[Database]`;
                    const dbPath = path.join(this.workspace.rootPath, '.meshy', 'memory.db');
                    if (fs.existsSync(dbPath)) {
                        try {
                            fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
                            systemOutput += `\n- SQLite DB: OK (Read/Write access)`;
                        } catch {
                            systemOutput += `\n- SQLite DB: ERROR (Permission denied)`;
                        }
                    } else {
                        systemOutput += `\n- SQLite DB: NO (Not created yet)`;
                    }

                    systemOutput += `\n\n[Embedding]`;
                    systemOutput += `\n- Expected Dimension: 768 (bge-base-en-v1.5)`;

                    systemOutput += `\n\nDiagnostics complete.`;
                } catch (e: any) {
                    systemOutput += `\n\n[Error during diagnostics] ${e.message}`;
                }
                break;
            }

            case 'compact':
                systemOutput = '[Slash] Triggering history compaction...';
                await this.compactionAgent.compact(this.session);
                systemOutput += '\nCompaction done. Reduced tokens by discarding old tool calls.';
                break;

            case 'workflow': {
                const subCmd = (command.args || '').trim().split(/\s+/);
                const action = subCmd[0] || 'list';
                const workflows = loadWorkflows(this.workspace.rootPath); // Assuming loadWorkflows is still used

                switch (action) {
                    case 'list': {
                        if (workflows.length === 0) {
                            systemOutput = '[Workflow] No workflows found in .meshy/workflows/';
                        } else {
                            const wLines = ['\n  Available Workflows:'];
                            for (const wf of workflows) {
                                wLines.push(`    • ${wf.name} — ${wf.description || 'No description'}`);
                                wLines.push(`      Steps: ${wf.steps.map(s => s.name).join(' -> ')}`);
                            }
                            systemOutput = wLines.join('\n');
                        }
                        break;
                    }
                    case 'run': {
                        const targetName = subCmd[1];
                        if (!targetName) {
                            systemOutput = '[Workflow] Usage: /workflow run <workflow-name>';
                            break;
                        }

                        const wf = workflows.find(w => w.name === targetName);
                        if (!wf) {
                            systemOutput = `[Workflow] Workflow "${targetName}" not found.`;
                            break;
                        }

                        const initialInput = command.args.replace(/^run\s+[^\s]+\s*/, '');
                        systemOutput = `[Workflow] Starting pipeline: ${wf.name}...`;

                        // Bridge WorkflowEngine with WorkerAgent
                        const engine = new WorkflowEngine(
                            async (step: import('../workflow/engine.js').StepDefinition, input: string) => {
                                const agentConfig = step.agent
                                    ? this.subagentRegistry.getAgent(step.agent)
                                    : this.subagentRegistry.getAgent('coder'); // default

                                if (!agentConfig) throw new Error(`Agent not found: ${step.agent || 'coder'}`);

                                const workerGuard = new SecurityGuard(
                                    (this.sandbox.getMode() as unknown as SecurityExecutionMode) ?? SecurityExecutionMode.SMART
                                );
                                const worker = new WorkerAgent(agentConfig, this.workspace, this.toolRegistry, this.providerResolver, workerGuard);

                                const fullPrompt = `${step.promptTemplate}\n\n[Input]\n${input}`;
                                return await worker.execute(fullPrompt, {
                                    parentSession: this.session,
                                    abortSignal: this.abortController?.signal
                                });
                            }
                        );

                        try {
                            const results = await engine.run(wf, initialInput);
                            console.log(`\n[Workflow] Pipeline "${wf.name}" completed successfully.`);
                            // Report results back to main session
                            let report = `Workflow "${wf.name}" execution report:\n`;
                            for (const [stepId, state] of results.entries()) {
                                report += `\n--- Step: ${stepId} [${state.status}] ---\n${state.output}\n`;
                            }
                            this.addMessageAndAppend({ role: 'assistant', content: report });
                            this.daemon?.broadcast('agent:text', report);
                        } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : String(err);
                            console.error(`\n[Workflow] Pipeline failed: ${msg}`);
                            this.addMessageAndAppend({ role: 'assistant', content: `Workflow execution failed: ${msg}` });
                        }
                        break;
                    }
                    default:
                        console.log('[Workflow] Unknown sub-command. Use: list, run <name>');
                }
                break;
            }

            case 'init': {
                const root = this.workspace.rootPath;
                const filesToCheck = ['package.json', 'Cargo.toml', 'requirements.txt', 'go.mod', 'README.md'];
                let structureInfo = '';
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const items = fs.readdirSync(root).filter((n: string) => !n.startsWith('.') && n !== 'node_modules');
                    structureInfo += `[Workspace Root Files & Folders]\n${items.join(', ')}\n\n`;
                    for (const f of filesToCheck) {
                        const fp = path.join(root, f);
                        if (fs.existsSync(fp)) {
                            // Only load the first 2000 characters to avoid huge context usage
                            structureInfo += `[Content of ${f}]\n${fs.readFileSync(fp, 'utf8').substring(0, 2000)}\n\n`;
                        }
                    }
                } catch (e) {
                    structureInfo += 'Failed to reliably read workspace structure.\n';
                }

                command.args = `你现在执行工作区初始化流程，我已经为你提取了项目的结构和核心配置信息：\n\n${structureInfo}\n\n【必须执行的指令】\n1. **绝对不要**使用 bash、grep、readFile 工具去进一步探索文件，只利用我上面已经提供给你的信息！\n2. 推断该项目的技术栈，在工作区创建 \`.meshy/context/tech-stack.md\` 并写入推断出的技术栈内容。\n3. 创建 \`.meshy/context/product.md\` 框架空模版，完成后，并在对话中询问我该项目的业务逻辑、核心功能和目标用户，以便我后续补充。\n4. 在成功创建这俩个文件后再提问。` + (command.args ? '\n\n用户附加信息：' + command.args : '');
            }
            // Fallthrough to the standard LLM execution flow
            case 'ask':
            case 'plan':
            case 'summarize':
                // 这些命令带有参数，仍需走 LLM 流程但附带约束
                // 将约束信息注入后走正常 runTask 路径
                if (command.args) {
                    const constraint = command.type === 'ask'
                        ? 'READ-ONLY mode: Do NOT use EditFile or WriteFile tools.'
                        : command.type === 'plan'
                            ? 'PLAN-ONLY mode: Output a structured task breakdown. Do NOT modify any files.'
                            : `Mode: ${command.type}`;
                    this.addMessageAndAppend({ role: 'user', content: command.args });

                    const decision = await this.router.classify(command.args);
                    const catalogAdvert = this.toolRegistry.getCatalog().getAdvertText();

                    // 补充 MCP 广告
                    const mcpSummaries = this.workspace.mcpHost.getServerSummaries();
                    const mcpAdvert = mcpSummaries.length > 0
                        ? '\n\nAvailable MCP Servers:\n' + mcpSummaries.map((s: any) => `- [${s.name}] (${s.status}): ${s.description}`).join('\n')
                        : '';

                    const builder = new SystemPromptBuilder(BASE_SYSTEM_PROMPT)
                        .withRoutingHint(decision.systemPromptHint)
                        .withConstraint(constraint);

                    if (catalogAdvert || mcpAdvert) {
                        builder.withCatalogAdvert((catalogAdvert + mcpAdvert).trim());
                    }

                    const basePrompt = builder.build();
                    const parsedArgs = InputParser.parse(command.args);
                    const injection = await this.injector.resolve(
                        parsedArgs, decision, basePrompt, this.session, this.providerResolver, this.workspace.rootPath
                    );

                    // 进入正常的 LLM 推理循环
                    await this.runLLMLoop(injection);
                }
                break;

            case 'feedback': {
                const arg = (command.args || '').trim().toLowerCase();
                const feedbackType: FeedbackType | null =
                    (arg === '+' || arg === 'positive' || arg === 'up' || arg === 'good')
                        ? 'thumbs_up'
                        : (arg === '-' || arg === 'negative' || arg === 'down' || arg === 'bad')
                            ? 'thumbs_down'
                            : null;

                if (!feedbackType) {
                    console.log('[Feedback] Usage: /feedback <+|-> or /feedback <positive|negative>');
                    console.log('  Examples: /feedback +   /feedback negative');
                    break;
                }

                const icon = feedbackType === 'thumbs_up' ? '👍' : '👎';
                console.log(`${icon} Feedback recorded: ${feedbackType}`);

                try {
                    await this.workspace.reflectionEngine.onUserFeedback(this.session, feedbackType);
                    console.log('[Feedback] Reflection capsule created from session experience.');
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error(`[Feedback] Failed to process: ${msg}`);
                }
                break;
            }
        }
    }

    /**
     * Main execution loop.
     * Phase 2 增强：先走 InputParser 控制语法 → IntentRouter 分类 → LazyInjector 动态组装。
     */
    public async runTask(userPrompt: string, context?: { mode?: string, attachments?: { name: string, type: string, data: string }[] }): Promise<void> {
        if (this.isRunning) {
            console.log(`[Engine] Mission already in progress. Ignoring new input: ${userPrompt}`);
            this.daemon?.broadcast('agent:text', { text: '\n[System]: A task is currently running. Please wait or stop it first.\n', id: `sys-${Date.now()}` });
            return;
        }

        this.isRunning = true;
        this.abortController = new AbortController();

        try {
            await this._runTaskInternal(userPrompt, context);
        } finally {
            this.isRunning = false;
        }
    }

    private async _runTaskInternal(userPrompt: string, context?: { mode?: string, attachments?: { name: string, type: string, data: string }[] }): Promise<void> {
        // Phase 4: 初始化记忆库
        await this.workspace.memoryStore.initialize();

        // Phase 5: 启动开机自启的 MCP Servers
        await this.workspace.mcpHost.ensureAutoStartServers();

        // ── Phase 2: 输入语法解析 ──
        const parsed = InputParser.parse(userPrompt);

        // 处理 slash 命令（拦截并提前返回）
        if (parsed.slashCommand) {
            await this.handleSlashCommand(parsed.slashCommand, parsed);
            return;
        }

        // Phase 15: 自定义 Markdown 命令拦截
        if (userPrompt.startsWith('/')) {
            const spaceIdx = userPrompt.indexOf(' ');
            const cmdName = spaceIdx > 0
                ? userPrompt.slice(1, spaceIdx).toLowerCase()
                : userPrompt.slice(1).toLowerCase();
            const cmdArgs = spaceIdx > 0 ? userPrompt.slice(spaceIdx + 1).trim() : '';

            if (this.customCommands.has(cmdName)) {
                const renderedPrompt = this.customCommands.renderPrompt(cmdName, cmdArgs);
                if (renderedPrompt) {
                    const cmdConfig = this.customCommands.getCommand(cmdName)!;
                    this.logger.engine(`Executing custom command: /${cmdName}`, { args: cmdArgs });

                    if (!this.session.title && this.session.history.length === 0) {
                        const trimmed = renderedPrompt.trimStart();
                        if (trimmed) {
                            this.session.title = trimmed.length > 40 ? trimmed.substring(0, 40) + '...' : trimmed;
                        }
                    }

                    // 将渲染后的 prompt 作为用户消息注入
                    let finalContent: any = renderedPrompt;
                    if (context?.attachments && context.attachments.length > 0) {
                        finalContent = [{ type: 'text', text: renderedPrompt }];
                        for (const att of context.attachments) {
                            if (att.type.startsWith('image/')) {
                                finalContent.push({ type: 'image', mimeType: att.type, data: att.data });
                            } else {
                                finalContent.push({ type: 'file', mimeType: att.type, data: att.data });
                            }
                        }
                    }
                    this.addMessageAndAppend({ role: 'user', content: finalContent });

                    // 使用命令绑定的模型或默认模型
                    const decision = await this.router.classify(renderedPrompt);
                    const builder = new SystemPromptBuilder(BASE_SYSTEM_PROMPT)
                        .withRoutingHint(decision.systemPromptHint);

                    const mode = (context?.mode || this.sandbox.getMode()) as string;
                    if (mode === 'smart') {
                        builder.withConstraint('Explore actively, but ask for permission before editing code. Use tool calls proactively to understand but pause before taking irreversible actions.');
                    } else if (mode === 'auto') {
                        builder.withConstraint('Execute fully autonomously until the objective is 100% complete. Do not ask for user permission, only report when fully done.');
                    }

                    // Attachments are now natively passed in the user message content array
                    const basePrompt = builder.build();
                    const injectionParsed = InputParser.parse(renderedPrompt);
                    const injection = await this.injector.resolve(
                        injectionParsed, decision, basePrompt, this.session, this.providerResolver, this.workspace.rootPath
                    );

                    // 如果命令指定了特定模型
                    if (cmdConfig.model) {
                        injection.subagent = { ...(injection.subagent || {} as any), model: cmdConfig.model };
                    }

                    await this.runLLMLoop(injection);
                    return;
                }
            }
        }

        if (!this.session.title && this.session.history.length === 0) {
            const trimmed = userPrompt.trimStart();
            if (trimmed) {
                this.session.title = trimmed.length > 40 ? trimmed.substring(0, 40) + '...' : trimmed;
            }
        }

        let finalContent: any = userPrompt;
        if (context?.attachments && context.attachments.length > 0) {
            finalContent = [{ type: 'text', text: userPrompt }];
            for (const att of context.attachments) {
                if (att.type.startsWith('image/')) {
                    finalContent.push({ type: 'image', mimeType: att.type, data: att.data });
                } else {
                    finalContent.push({ type: 'file', mimeType: att.type, data: att.data });
                }
            }
        }
        this.addMessageAndAppend({ role: 'user', content: finalContent });

        // ── Phase 2: 意图路由（使用清洗后的文本） ──
        const decision = await this.router.classify(parsed.cleanText);
        console.log(`[Router] Intent: ${decision.intent} | Tier: ${decision.modelTier} | Confidence: ${decision.confidence.toFixed(2)}`);

        // ── Phase 4: 被动召回历史经验 (Advanced Feature, only on complex intents or explicit @memory) ──
        let memoryHint = '';
        const isComplexTask = decision.intent === 'task_planning' || decision.intent === 'debug';
        const isExplicitMemoryMention = parsed.mentions.some(m => m.raw.toLowerCase().includes('memory'));

        if (isComplexTask || isExplicitMemoryMention) {
            memoryHint = await this.workspace.reflectionEngine.recallRelevantCapsules(parsed.cleanText);
        }

        // ── Phase 2: 使用 SystemPromptBuilder 组装 Prompt ──
        const catalogAdvert = this.toolRegistry.getCatalog().getAdvertText();

        // 补充 MCP 广告
        const mcpSummaries = this.workspace.mcpHost.getServerSummaries();
        const mcpAdvert = mcpSummaries.length > 0
            ? '\n\nAvailable MCP Servers:\n' + mcpSummaries.map((s: any) => `- [${s.name}] (${s.status}): ${s.description}`).join('\n')
            : '';

        const builder = new SystemPromptBuilder(BASE_SYSTEM_PROMPT)
            .withRepoMap(this.workspace.getRepoMap())
            .withRoutingHint(decision.systemPromptHint)
            .withEnvironmentContext(process.platform, this.workspace.rootPath);

        if (memoryHint) builder.withMemoryHint(memoryHint);

        // Phase 20: Inject cross-session progress context and Health Check
        const isFirstTurn = this.session.history.length === 0;

        const progressContext = this.progressTracker.getRecentProgress();
        if (progressContext && this.session.history.length <= 1) {
            builder.withConstraint(`\n## Previous Session Progress\nThe following is a summary of work done in previous sessions on this project:\n${progressContext}`);
        }

        if (isFirstTurn) {
            const healthReport = await this.healthInspector.inspectEnvironment(this.session);
            if (!healthReport.isHealthy && healthReport.recommendation) {
                // Force the agent to acknowledge and prioritize the broken environment
                this.logger.warn('ENGINE', `Health Check Failed: ${healthReport.recommendation}`);
                builder.withConstraint(`\n## 🚨 CRITICAL ENVIRONMENT WARNING 🚨\n${healthReport.recommendation}\n\nYou MUST address or acknowledge these issues in your first response before proceeding with the main task.`);
            }
        }

        if (catalogAdvert || mcpAdvert) {
            builder.withCatalogAdvert((catalogAdvert + mcpAdvert).trim());
        }

        const mode = (context?.mode || this.sandbox.getMode()) as string;
        if (mode === 'smart') {
            builder.withConstraint('Explore actively, but ask for permission before editing code. Use tool calls proactively to understand but pause before taking irreversible actions.');
        } else if (mode === 'auto') {
            builder.withConstraint('Execute fully autonomously until the objective is 100% complete. Do not ask for user permission, only report when fully done.');
        }

        // Attachments are natively passed in the user message content array

        // Phase 16: Ritual 上下文注入
        const ritualContext = this.ritualLoader.buildPromptInjection(isFirstTurn);
        if (ritualContext) {
            builder.withRitualContext(ritualContext);
        }

        // Phase 19: User Profile (长记忆潜意识) 注入
        const userProfile = await this.workspace.memoryStore.getUserProfile();
        if (userProfile) {
            builder.withUserProfile(userProfile);
        }

        // Phase 20: 针对代码生成/修改意图的强制写文件约束
        if (decision.intent === 'code_generate' || decision.intent === 'code_edit') {
            builder.withConstraint("CRITICAL: You are generating or editing code. Your final response MUST entail calling 'write', 'editFile', or 'runCommand' to save the code to the filesystem. DO NOT JUST PRINT THE CODE.");
        }

        // 注入 @file: 引用的文件内容到上下文
        for (const mention of parsed.mentions) {
            if (mention.namespace === 'file') {
                try {
                    const fileContent = this.aci.readFile(mention.value);
                    builder.withContextBlock(`file:${mention.value}`, fileContent.content);
                } catch {
                    console.warn(`[InputParser] Could not read file: ${mention.value}`);
                }
            }
        }

        const basePrompt = builder.build();

        // Phase 9: 检查是否有针对具体 Agent 的强召（Worker Agent 拦截）
        const agentMention = parsed.mentions.find(m => m.namespace === 'agent' || m.namespace === 'raw');
        if (agentMention) {
            const agentConfig = this.subagentRegistry.getAgent(agentMention.value);
            if (agentConfig) {
                // 由 TaskEngine (TeamLead) 衍生出独立的 Worker 开始工作，避开主链路
                const workerGuard = new SecurityGuard(
                    (this.sandbox.getMode() as unknown as SecurityExecutionMode) ?? SecurityExecutionMode.SMART
                );
                const worker = new WorkerAgent(agentConfig, this.workspace, this.toolRegistry, this.providerResolver, workerGuard);

                // 将必要的工具依赖注入到 Subagent
                const injectedTools: import('../llm/provider.js').StandardTool[] = [];
                let injectedPrompt = '';

                const skillNamesToInject = new Set<string>([
                    ...parsed.skills.map(s => s.value),
                    ...(decision.suggestedSkills || [])
                ]);

                for (const sName of skillNamesToInject) {
                    const skill = this.skillRegistry.getSkill(sName);
                    if (skill) {
                        const body = this.skillRegistry.getSkillBody(skill.name);
                        if (body) injectedPrompt += `\n--- Skill: ${skill.name} ---\n${body}`;
                        if (skill.tools) {
                            injectedTools.push(...skill.tools.map(t => ({
                                name: t.name,
                                description: t.description,
                                inputSchema: t.inputSchema
                            })));
                        }
                    }
                }

                const report = await worker.execute(parsed.cleanText, {
                    parentSession: this.session,
                    injectedTools,
                    injectedPrompt,
                    abortSignal: this.abortController?.signal
                });

                // Orchestrator 收集汇报
                this.addMessageAndAppend({ role: 'assistant', content: `[Worker @${agentConfig.name} Report]\n${report}` });
                this.daemon?.broadcast('agent:text', { text: `\n[Worker @${agentConfig.name} Report]\n${report}\n`, id: `worker-${Date.now()}` });

                this.daemon?.broadcast('agent:done', {});
                return;
            }
        }

        await this.runLLMLoopWithDynamicInjection(parsed, decision, basePrompt);

        // Execution finished successfully, history is preserved in the ongoing session.
    }

    /**
     * 中断当前的 LLM 任务执行。
     */
    public interrupt(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.logger.engine('Task interrupted by user.');
            this.addMessageAndAppend({ role: 'system', content: 'Task interrupted by user via stop button.' });
            this.daemon?.broadcast('agent:done', {});
        }
    }

    /**
     * 恢复由于崩溃或手动中断（Ctrl+C）遗留的旧会话。
     * 直接进入带有额外系统提示的 LLM 推理循环。
     */
    public async resumeTask(): Promise<void> {
        if (this.isRunning) {
            console.log(`[Engine] Mission already in progress. Ignoring resume request.`);
            this.daemon?.broadcast('agent:text', { text: '\n[System]: A task is currently running. Please wait or stop it first.\n', id: `sys-${Date.now()}` });
            return;
        }

        this.isRunning = true;
        this.abortController = new AbortController();

        try {
            await this._resumeTaskInternal();
        } finally {
            this.isRunning = false;
        }
    }

    private async _resumeTaskInternal(): Promise<void> {
        console.log(`[Engine] Resuming interrupted session: ${this.session.id}`);
        this.logger.engine(`Resuming interrupted session: ${this.session.id}`);

        // Phase 4 & 5 依赖初始化
        await this.workspace.memoryStore.initialize();
        await this.workspace.mcpHost.ensureAutoStartServers();

        // 重新获取 catalog 和 mcp
        const catalogAdvert = this.toolRegistry.getCatalog().getAdvertText();
        const mcpSummaries = this.workspace.mcpHost.getServerSummaries();
        const mcpAdvert = mcpSummaries.length > 0
            ? '\n\nAvailable MCP Servers:\n' + mcpSummaries.map((s: any) => `- [${s.name}] (${s.status}): ${s.description}`).join('\n')
            : '';

        const builder = new SystemPromptBuilder(BASE_SYSTEM_PROMPT)
            .withRoutingHint('CRITICAL: The previous execution of this session was abruptly interrupted. Review your history context carefully and pick up exactly where you left off.')
            .withCatalogAdvert((catalogAdvert + mcpAdvert).trim())
            .withEnvironmentContext(process.platform, this.workspace.rootPath);

        // Phase 19: User Profile (长记忆潜意识) 注入
        const userProfile = await this.workspace.memoryStore.getUserProfile();
        if (userProfile) {
            builder.withUserProfile(userProfile);
        }

        const resumePrompt = builder.build();

        // 直接发起 LLM Loop 续接
        await this.runLLMLoop({
            systemPrompt: resumePrompt,
            tools: [], // 工具列表在 runLLMLoop 中再组装
            subagent: null as any, // 恢复暂不支持 subagent 上下文
            selectedSkills: [],
            reasonSummary: 'resume-session',
        });

        this.workspace.snapshotManager.clearSnapshot(this.session.id);
    }

    /**
     * 核心 LLM 推理循环。接收注入结果，执行多轮工具调用直至完成或重试上限。
     */
    private async runLLMLoopWithDynamicInjection(
        parsed: import('../router/input-parser.js').ParsedInput,
        decision: import('../router/intent.js').RoutingDecision,
        basePrompt: string,
    ): Promise<void> {
        let currentParsed = parsed;
        let currentDecision = decision;

        while (true) {
            const injection = await this.injector.resolve(
                currentParsed,
                currentDecision,
                basePrompt,
                this.session,
                this.providerResolver,
                this.workspace.rootPath,
            );

            if (!Array.isArray((this.session as any).runtimeDecisions)) {
                (this.session as any).runtimeDecisions = [];
            }

            const appendRuntimeDecision = (this.session as any).appendRuntimeDecision;
            const nextLoopIndex = (this.session as any).runtimeDecisions.length;
            const decisionRecord = {
                loopIndex: nextLoopIndex,
                injectedSkills: injection.selectedSkills ?? [],
                activeMcpServers: Array.from(this.session.activatedMcpServers ?? []),
                reasonSummary: injection.reasonSummary,
            };

            if (typeof appendRuntimeDecision === 'function') {
                appendRuntimeDecision.call(this.session, decisionRecord);
            } else {
                (this.session as any).runtimeDecisions.push(decisionRecord);
            }

            const loopResult = await this.runSingleLLMIteration(injection);
            if (!loopResult?.continueLoop) break;

            currentParsed = {
                ...currentParsed,
                cleanText: loopResult.nextUserPrompt || currentParsed.cleanText,
            };
            currentDecision = currentDecision;
        }
    }

    private async runSingleLLMIteration(injection: import('../injector/lazy.js').InjectionResult): Promise<any> {
        await this.runLLMLoop(injection);
        return { continueLoop: false };
    }

    private async runLLMLoop(injection: import('../injector/lazy.js').InjectionResult): Promise<void> {
        let isDone = false;
        let retries = 0;

        let activeLLM: import('../llm/provider.js').ILLMProvider;
        if (injection.subagent && injection.subagent.model) {
            activeLLM = this.providerResolver.getProvider(injection.subagent.model);
        } else {
            activeLLM = this.providerResolver.getProvider();
        }

        try {
            while (!isDone && retries < this.maxRetries) {
                if (this.abortController?.signal.aborted) {
                    console.log('\n[Engine] Loop aborted by signal.');
                    break;
                }

                try {
                    // Phase 14: Auto-compact long sessions
                    if (this.compactionAgent.shouldCompact(this.session)) {
                        this.logger.engine('Session exceeds compaction threshold, auto-compacting...');
                        await this.compactionAgent.compact(this.session);

                        // Phase 20: Write progress entry after compaction
                        this.progressTracker.appendEntry({
                            sessionId: this.session.id,
                            timestamp: new Date().toISOString(),
                            summary: typeof this.session.history[0]?.content === 'string'
                                ? this.session.history[0].content.slice(0, 500)
                                : 'Session compacted.',
                        });
                    }
                    const registryTools = this.toolRegistry.toStandardTools(this.session.activatedTools);
                    const mcpTools = this.workspace.mcpHost.getAllTools(this.session.activatedMcpServers);
                    const allTools = [...registryTools, ...mcpTools, ...injection.tools];

                    const prompt: StandardPrompt = {
                        systemPrompt: injection.systemPrompt,
                        messages: this.session.history,
                        tools: allTools,
                    };

                    interface PendingToolCall {
                        id: string;
                        name: string;
                        rawArgs: string;
                    }
                    const pendingToolCalls: PendingToolCall[] = [];
                    let fullResponseText = '';

                    const responseMsgId = `msg-${Date.now()}`;

                    this.abortController = new AbortController();

                    await activeLLM.generateResponseStream(prompt, (event) => {
                        const normalizedEvent = normalizeAgentMessageEvent(event);

                        if (event.type === 'text') {
                            if (event.replace) {
                                fullResponseText = event.data;
                                // We can't easily rewrite stdout, so just print a small indicator or the delta if we wanted to
                            } else {
                                fullResponseText += event.data;
                                process.stdout.write(event.data);
                            }
                            this.daemon?.broadcast('agent:text', {
                                text: event.data,
                                id: responseMsgId,
                                replace: event.replace,
                                stream: normalizedEvent,
                            });
                        } else if (event.type === 'reasoning_chunk') {
                            this.daemon?.broadcast('agent:text', {
                                reasoning: event.data,
                                id: responseMsgId,
                                stream: normalizedEvent,
                            });
                        } else if (event.type === 'tool_call_start') {
                            const newCall = { id: event.data.id, name: event.data.name, rawArgs: '' };
                            pendingToolCalls.push(newCall);
                            process.stdout.write(`\n[Agent]: Calling tool "${newCall.name}"...\n`);
                            this.logger.tool(`Tool call started: ${newCall.name}`, { id: newCall.id });
                            this.daemon?.broadcast('agent:tool_call', {
                                id: newCall.id,
                                name: newCall.name,
                                stream: normalizedEvent,
                            });
                        } else if (event.type === 'tool_call_chunk') {
                            if (pendingToolCalls.length > 0) {
                                const pendingObj = pendingToolCalls[pendingToolCalls.length - 1];
                                pendingObj.rawArgs += event.data;
                                // Optionally broadcast the accumulated args to the frontend for streaming
                                this.daemon?.broadcast('agent:tool_call', {
                                    id: pendingObj.id,
                                    name: pendingObj.name,
                                    args: pendingObj.rawArgs,
                                    stream: normalizedEvent,
                                });
                            }
                        } else if (event.type === 'done') {
                            isDone = true;
                        } else if (event.type === 'error') {
                            console.error('\n[StreamError]:', event.data);
                        }
                    });

                    if (pendingToolCalls.length === 0) {
                        this.addMessageAndAppend({ role: 'assistant', content: fullResponseText });
                        isDone = true;
                        break;
                    }

                    isDone = false;

                    // 1. Add ALL tool_call messages to history first
                    for (const call of pendingToolCalls) {
                        const parsedArgs = call.rawArgs ? JSON.parse(call.rawArgs) : {};
                        this.addMessageAndAppend({
                            role: 'assistant',
                            content: {
                                type: 'tool_call',
                                id: call.id,
                                name: call.name,
                                arguments: parsedArgs,
                            },
                        });
                    }

                    // Phase 5: 在真正执行 Tool 前，持久化内存现场。防止工具死锁或 OS 宕机。
                    this.workspace.snapshotManager.appendStateUpdate(this.session);

                    // 2. Execute ALL tools concurrently
                    const executionPromises = pendingToolCalls.map(async (call) => {
                        const parsedArgs = call.rawArgs ? JSON.parse(call.rawArgs) : {};
                        const resultObj = await this.executeTool(call.id, call.name, parsedArgs, injection.subagent?.allowedTools);
                        this.daemon?.broadcast('agent:tool_result', { id: call.id, name: call.name, result: resultObj.output, isError: resultObj.isError });
                        return { id: call.id, result: resultObj.output };
                    });

                    const results = await Promise.all(executionPromises);

                    // 3. Add ALL tool_result messages to history in order
                    // Phase 20: Offload large tool outputs to files
                    for (const { id, result } of results) {
                        const toolName = pendingToolCalls.find(c => c.id === id)?.name ?? 'unknown';
                        const offloadResult = this.offloader.process(toolName, id, String(result));
                        this.addMessageAndAppend({
                            role: 'user',
                            content: {
                                type: 'tool_result',
                                id: id,
                                content: offloadResult.content,
                            },
                        });
                    }

                    // Phase 5: 响应也写入快照
                    this.workspace.snapshotManager.appendStateUpdate(this.session);

                } catch (err: unknown) {
                    if ((err as any).isSandboxRejection) {
                        this.logger.error('ENGINE', `Action denied by Sandbox. Aborting execution loop.`);
                        console.log(`\n[Engine] Action denied by Sandbox. Aborting execution loop.`);
                        this.addMessageAndAppend({
                            role: 'user',
                            content: `System Warning: ${(err as Error).message}. Execution aborted by user/sandbox.`
                        });
                        this.interrupt();
                        break;
                    }

                    retries++;
                    const message = err instanceof Error ? err.message : String(err);
                    this.logger.error('ENGINE', `Retry ${retries}/${this.maxRetries}: ${message}`);
                    console.error(`\n[Engine] Retry ${retries}/${this.maxRetries}: ${message}`);

                    // Phase 14: Graceful Degradation (Fallback) Mechanism
                    // If we detect an API dropout, timeout, rate limit, or server error, we attempt a fallback.
                    const isApiFailure = /429|500|502|503|504|timeout|failed to fetch|econnreset|ehostunreach/i.test(message);

                    let fallbackTriggered = false;
                    if (isApiFailure) {
                        const fallbackProvider = this.providerResolver.getFallbackProvider();
                        if (fallbackProvider && activeLLM !== fallbackProvider) {
                            console.log(`\n[Graceful Degradation] Primary LLM failed (${message}). Automatically falling back to backup provider...`);
                            this.logger.engine(`Switching to Fallback Provider due to API error: ${message}`);

                            this.addMessageAndAppend({
                                role: 'user',
                                content: `System Warning: Primary LLM API crashed (${message}). Switched to Backup Fallback Model. Please continue task exactly where you left off.`,
                            });

                            activeLLM = fallbackProvider;
                            fallbackTriggered = true;
                        }
                    }

                    if (!fallbackTriggered) {
                        this.addMessageAndAppend({
                            role: 'user',
                            content: `System Error: ${message}. Please self-correct or ask the user for help.`,
                        });
                    }

                    // Phase 19: Aggressive context compression on sequential errors
                    if (retries >= 2 && !fallbackTriggered) {
                        try {
                            console.log(`\n[Engine] High retry count detected. Triggering forced context compaction to save context window...`);
                            this.logger.engine('Triggering forced context compaction on retry loop.');
                            await this.compactionAgent.compact(this.session);
                        } catch (e) {
                            this.logger.error('ENGINE', `Forced compaction failed during retry loop: ${e}`);
                        }
                    }

                    // Exponental Backoff simulation, wait briefly before blasting the API again
                    await new Promise(res => setTimeout(res, 2000 * retries));

                } finally {
                    this.abortController = null;
                }
            }

            if (retries >= this.maxRetries) {
                console.warn('\n[Engine] Max retries reached. Task suspended.');
            }
        } finally {
            this.session.clearActivatedTools();
            this.daemon?.broadcast('agent:done', {});
            this.workspace.reflectionEngine.onSessionComplete({ session: this.session }).catch(() => { });
        }
    }

    /**
     * Phase 4: 接收用户反馈（点赞/踩），触发经验标记与持久化。
     */
    public async submitFeedback(feedback: FeedbackType): Promise<void> {
        await this.workspace.reflectionEngine.onUserFeedback(this.session, feedback);
    }

    // ─── ACI 工具注册到 ToolRegistry ───
    private registerAciTools(): void {
        const self = this;
        const aci = this.aci;
        const lsp = this.workspace.lspManager;
        const daemon = this.daemon;

        this.toolRegistry.register(defineTool('listSkills', {
            description: 'List all available skills configured in the workspace (.agent/skills). Returns summary info about what skills can do, without showing full prompt bodies to save tokens.',
            parameters: z.object({}),
            async execute() {
                const skills = self.skillRegistry.listSkills();
                const result = skills.map(s => ({
                    name: s.name,
                    description: s.description,
                    keywords: s.keywords,
                    tools: s.tools?.map(t => t.name)
                }));
                return { output: JSON.stringify(result, null, 2) };
            },
        }));

        this.toolRegistry.register(defineTool('readFile', {
            description: 'Read file contents with line numbers. Supports pagination via startLine/maxLines.',
            parameters: z.object({
                filePath: z.string().optional().describe('Path to the file relative to workspace root'),
                path: z.string().optional().describe('Alias of filePath (backwards compatibility)'),
                startLine: z.coerce.number().describe('Starting line number (1-indexed), default 1').optional(),
                maxLines: z.coerce.number().describe('Max lines to return, default 500').optional(),
            }).refine(data => !!data.filePath || !!data.path, {
                message: 'filePath or path is required',
            }),
            async execute(args) {
                const resolvedPath = args.filePath || args.path || '';
                const res = aci.readFile(resolvedPath, args.startLine, args.maxLines);
                daemon?.broadcast('agent:tool_result', { tool: 'readFile', result: res });
                return { output: JSON.stringify(res) };
            },
        }));

        this.toolRegistry.register(defineTool('editFile', {
            description: 'Replace a specific text block in a file. Requires expectedHash from a prior readFile call.',
            parameters: z.object({
                filePath: z.string(),
                expectedHash: z.string().describe('SHA-256 hash from readFile to guard concurrency'),
                searchBlock: z.string().describe('Exact text to find'),
                replaceBlock: z.string().describe('Replacement text'),
            }),
            async execute(args) {
                // LSP 诊断拦截
                const currentContent = aci.readFile(args.filePath);
                const simulatedContent = currentContent.content.replace(args.searchBlock, args.replaceBlock);
                const diagnostics = await lsp.getDiagnostics(args.filePath, simulatedContent);

                if (diagnostics.length > 0) {
                    const errorMessages = diagnostics.map(d => `  ${d}`).join('\n');
                    let retryCount = self.editAutoFixRetries.get(args.filePath) || 0;
                    retryCount++;
                    self.editAutoFixRetries.set(args.filePath, retryCount);

                    daemon?.broadcast('agent:error', { tool: 'editFile', diagnostics });

                    if (retryCount >= self.MAX_AUTOFIX_RETRIES) {
                        return {
                            output: `Edit REJECTED by LSP Guard. ${diagnostics.length} error(s):\n${errorMessages}\n[CIRCUIT BREAKER] MAX_AUTOFIX_RETRIES (${self.MAX_AUTOFIX_RETRIES}) reached for this file. You MUST stop fixing this file and report to the user for manual intervention.`
                        };
                    }

                    return {
                        output: `Edit REJECTED by LSP Guard. ${diagnostics.length} error(s):\n${errorMessages}\nPlease fix and retry. (Attempt ${retryCount}/${self.MAX_AUTOFIX_RETRIES})`,
                    };
                }

                // If successful, reset circuit breaker
                self.editAutoFixRetries.delete(args.filePath);

                aci.editFile(args.filePath, args.expectedHash, args.searchBlock, args.replaceBlock);
                daemon?.broadcast('agent:tool_result', { tool: 'editFile', success: true });
                return { output: `Successfully edited ${args.filePath}` };
            },
        }));
        this.toolRegistry.register(defineTool('runCommand', {
            description: 'Run a shell command in an isolated PTY. Use for running tests, build scripts, or fetching information.',
            parameters: z.object({
                command: z.string().describe('The shell command to execute'),
            }),
            async execute(args) {
                // Execute command and wait for result (up to 10 seconds for standard commands)
                const output = await aci.terminalManager.executeCommand(args.command, 10000);
                daemon?.broadcast('agent:tool_result', { tool: 'runCommand', success: true });
                return { output };
            },
        }));

        // ── delegateToAgent: Manager → Subagent 委派 ──
        const subagentRegistry = this.subagentRegistry;
        const providerResolver = this.providerResolver;
        const toolRegistryRef = this.toolRegistry;
        const parentSession = this.session;

        this.toolRegistry.register(defineTool('delegateToAgent', {
            description: 'Delegate a sub-task to a specialized sub-agent. The sub-agent runs in an isolated context and returns a result.',
            parameters: z.object({
                agentName: z.string().describe('Name of the sub-agent to delegate to'),
                taskDescription: z.string().describe('Detailed description of the task for the sub-agent'),
            }),
            async execute(args) {
                const result = await executeDelegate(args, {
                    subagentRegistry,
                    providerResolver,
                    toolRegistry: toolRegistryRef,
                    parentSession,
                });
                return { output: JSON.stringify(result) };
            },
        }));

        // ── Phase 14: TodoWrite / TodoRead 任务追踪工具 ──
        this.toolRegistry.register(createTodoWriteTool(() => this.session));
        this.toolRegistry.register(createTodoReadTool(() => this.session));

        // ── Phase 19/20: Search Project Memory ──
        const memoryStoreRef = this.workspace.memoryStore;
        this.toolRegistry.register(defineTool('searchProjectMemory', {
            description: 'Search the project\'s long term memory database (EvoMap) for past solutions, architecture decisions, and error recoveries using natural language or keywords.',
            parameters: z.object({
                query: z.string().describe('The search query or keyword representing the task or issue.'),
                limit: z.number().optional().describe('How many records to return (default 5)')
            }),
            async execute(args) {
                const results = await memoryStoreRef.searchCapsules(args.query, args.limit || 5);
                if (results.length === 0) return { output: 'No relevant memories found.' };
                return { output: '--- Memory Search Results ---\n' + results.map((r, i) => `${i + 1}. [${r.category}] ${r.summary}`).join('\n') };
            }
        }));
    }

    private async executeTool(id: string, name: string, args: Record<string, unknown>, allowedTools?: string[]): Promise<{ output: string, isError?: boolean, metadata?: Record<string, unknown> }> {
        // ── Phase 4: Intercept Selective MCP Tool Loading (Meta-Tool) ──
        if (name.startsWith('_load_mcp_server_')) {
            // Extract server name from the meta-tool name
            const serverNameRaw = name.replace('_load_mcp_server_', '');
            // We need the original server name. The meta-tool replaced special chars with '_'.
            // To be precise, we look up the server list to find the match.
            const serverSummaries = this.workspace.mcpHost.getServerSummaries();
            const matchedServer = serverSummaries.find(s => 
                s.name.replace(/[^a-zA-Z0-9_-]/g, '_') === serverNameRaw
            );

            if (matchedServer) {
                this.session.activatedMcpServers.add(matchedServer.name);
                this.logger.engine(`[Selective Loading] Activated MCP Server schema for: ${matchedServer.name}`);
                return { 
                    output: `[System] Successfully loaded all tool schemas for MCP server "${matchedServer.name}". They will be available in the 'tools' array in your next turn. Please proceed with your actual task using the newly available tools.` 
                };
            } else {
                return { output: `Error: Could not resolve MCP server for ${serverNameRaw}`, isError: true };
            }
        }

        // ── Phase 2: Agent Tool Whitelist Block ──
        if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(name)) {
            const reason = `[BLOCKED] Agent is not allowed to use tool "${name}". Please do not use this tool anymore.`;
            this.daemon?.broadcast('agent:error', { id, tool: name, reason });
            return { output: reason, isError: true };
        }

        // ── Phase 3: 沙盒审批网关 ──
        const actionType = name === 'readFile' ? 'read_file' : name === 'editFile' ? 'edit_file' : 'run_command';
        const detail = `${name}(${JSON.stringify(args).slice(0, 120)})`;
        const approval = await this.sandbox.requestApproval(actionType as any, detail);

        if (!approval.approved) {
            const reason = approval.reason || 'User denied the action.';
            this.daemon?.broadcast('agent:error', {
                id,
                tool: name,
                reason,
                policyDecision: {
                    decision: 'deny',
                    mode: this.toolRegistry.getPolicyMode(),
                    permissionClass: 'exec',
                    reason: 'sandbox denied action',
                },
            });
            // Throw an error that stops the inner execution and signals the LLM loop to stop retrying immediately
            const err = new Error(`Action denied by user or sandbox: ${reason}`);
            (err as any).isSandboxRejection = true;
            throw err;
        }

        // Broadcast if it was auto-approved by AI
        if (approval.autoApproved && this.daemon) {
            this.daemon.broadcast('agent:approve', { id, tool: name, reason: approval.reason || 'AI Secondary Reviewer approved automatically.' });
        }

        try {
            if (name.startsWith('mcp:')) {
                const output = await this.workspace.mcpHost.callTool(name, args);
                return { output };
            }

            const result = await this.toolRegistry.execute(name, args, {
                sessionId: this.session.id,
                workspaceRoot: process.cwd(),
                session: this.session, // 注入 Session 供按需工具 (useTool) 修改挂载状态
            });

            this.daemon?.broadcast('agent:tool_result', {
                id,
                tool: name,
                success: !result.isError,
                policyDecision: (result.metadata as Record<string, unknown> | undefined)?.policyDecision,
            });

            const policyDecision = (result.metadata as Record<string, unknown> | undefined)?.policyDecision as Record<string, unknown> | undefined;
            if (policyDecision) {
                this.daemon?.broadcast('agent:policy_decision', {
                    id,
                    tool: name,
                    ...policyDecision,
                });
            }

            if (result.isError) {
                this.daemon?.broadcast('agent:error', {
                    id,
                    tool: name,
                    reason: result.output,
                    policyDecision,
                });
            }

            return {
                output: result.output,
                isError: result.isError,
                metadata: result.metadata,
            };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.daemon?.broadcast('agent:error', { id, tool: name, error: message });
            return { output: `Error executing "${name}": ${message}`, isError: true };
        }
    }
}

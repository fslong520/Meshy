import { ILLMProvider, StandardPrompt } from '../llm/provider.js';
import { ProviderResolver } from '../llm/resolver.js';
import { AgentComputerInterface } from '../aci/index.js';
import { Session } from '../session/state.js';
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

export interface EngineOptions {
    maxRetries?: number;
    executionMode?: ExecutionMode;
    askUser?: AskUserCallback;
    daemon?: DaemonServer;
}

const BASE_SYSTEM_PROMPT = 'You are Meshy, an advanced multi-agent AI assistant. Utilize tools carefully to assist the user.';

export class TaskEngine {
    private providerResolver: ProviderResolver;
    public readonly workspace: Workspace;
    private aci: AgentComputerInterface;
    private session: Session;
    private maxRetries: number;

    // Phase 2 组件
    private router: IntentRouter;
    private skillRegistry: SkillRegistry;
    private subagentRegistry: SubagentRegistry;
    private injector: LazyInjector;

    // Phase 3 组件
    private sandbox: ExecutionSandbox;
    private daemon?: DaemonServer;

    // Phase 7 Circuit Breaker
    private editAutoFixRetries: Map<string, number> = new Map();
    private MAX_AUTOFIX_RETRIES = 3;

    // Tool System
    private toolRegistry: ToolRegistry;

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
        this.subagentRegistry = new SubagentRegistry();
        this.toolRegistry = createDefaultRegistry();

        const toolPackRegistry = createDefaultToolPackRegistry();
        this.injector = new LazyInjector(this.skillRegistry, this.subagentRegistry, this.toolRegistry, toolPackRegistry);
        this.skillRegistry.scan();
        this.subagentRegistry.scan();

        // Phase 3 init
        this.daemon = options.daemon;
        const askUser: AskUserCallback = options.askUser
            ?? (this.daemon ? this.daemon.requestApproval.bind(this.daemon) : this.defaultAskUser);
        const reviewer = new AISecondaryReviewer(this.providerResolver);
        this.sandbox = new ExecutionSandbox(options.executionMode || 'smart', askUser, reviewer);

        // Tool System init: 注册内置工具 + ACI 工具
        this.toolRegistry = createDefaultRegistry();
        this.registerAciTools();
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
        switch (command.type) {
            case 'clear':
                this.session.clear();
                console.log('[Slash] Session cleared.');
                break;

            case 'undo':
                console.log('[Slash] Undo requested — rolling back last edit via ACI.');
                // 未来可对接 git checkout / ACI 层回滚
                break;

            case 'help':
                console.log([
                    'Available commands:',
                    '  /ask <question>   — Ask without modifying code',
                    '  /plan <task>      — Plan mode, output structured steps',
                    '  /model [target]   — List providers or switch model (e.g. /model zeabur/gpt-5.2)',
                    '  /clear            — Clear current session',
                    '  /undo             — Roll back last edit',
                    '  /test             — Run tests',
                    '  /compact          — Compress conversation history',
                    '  /help             — Show this help',
                ].join('\n'));
                break;

            case 'model': {
                if (!command.args) {
                    // 列出所有可用 provider 和当前模型
                    const providers = this.providerResolver.listProviders();
                    const currentModel = this.providerResolver.getActiveDefault();
                    console.log('\n  Current model: ' + currentModel);
                    console.log('  Available providers:');
                    for (const p of providers) {
                        const url = p.baseUrl ? ` (${p.baseUrl})` : ' (official)';
                        console.log(`    • ${p.name} [${p.protocol}]${url}`);
                    }
                    console.log('\n  Usage: /model <providerName/modelId>');
                } else {
                    try {
                        this.providerResolver.switchModel(command.args.trim());
                        console.log(`[Model] Switched to: ${command.args.trim()}`);
                    } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        console.error(`[Model] Failed to switch: ${msg}`);
                    }
                }
                break;
            }

            case 'ask':
            case 'plan':
            case 'test':
            case 'summarize':
            case 'compact':
                // 这些命令带有参数，仍需走 LLM 流程但附带约束
                // 将约束信息注入后走正常 runTask 路径
                if (command.args) {
                    const constraint = command.type === 'ask'
                        ? 'READ-ONLY mode: Do NOT use EditFile or WriteFile tools.'
                        : command.type === 'plan'
                            ? 'PLAN-ONLY mode: Output a structured task breakdown. Do NOT modify any files.'
                            : `Mode: ${command.type}`;
                    this.session.addMessage({ role: 'user', content: command.args });

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
                        parsedArgs, decision, basePrompt, this.session, this.providerResolver,
                    );

                    // 进入正常的 LLM 推理循环
                    await this.runLLMLoop(injection);
                }
                break;
        }
    }

    /**
     * Main execution loop.
     * Phase 2 增强：先走 InputParser 控制语法 → IntentRouter 分类 → LazyInjector 动态组装。
     */
    public async runTask(userPrompt: string): Promise<void> {
        // Phase 4: 初始化记忆库
        await this.workspace.memoryStore.initialize();
        +
            // Phase 5: 启动开机自启的 MCP Servers
            await this.workspace.mcpHost.ensureAutoStartServers();

        // ── Phase 2: 输入语法解析 ──
        const parsed = InputParser.parse(userPrompt);

        // 处理 slash 命令（拦截并提前返回）
        if (parsed.slashCommand) {
            await this.handleSlashCommand(parsed.slashCommand, parsed);
            return;
        }

        this.session.addMessage({ role: 'user', content: userPrompt });

        // ── Phase 2: 意图路由（使用清洗后的文本） ──
        const decision = await this.router.classify(parsed.cleanText);
        console.log(`[Router] Intent: ${decision.intent} | Tier: ${decision.modelTier} | Confidence: ${decision.confidence.toFixed(2)}`);

        // ── Phase 4: 被动召回历史经验 ──
        const memoryHint = await this.workspace.reflectionEngine.recallRelevantCapsules(parsed.cleanText);

        // ── Phase 2: 使用 SystemPromptBuilder 组装 Prompt ──
        const catalogAdvert = this.toolRegistry.getCatalog().getAdvertText();

        // 补充 MCP 广告
        const mcpSummaries = this.workspace.mcpHost.getServerSummaries();
        const mcpAdvert = mcpSummaries.length > 0
            ? '\n\nAvailable MCP Servers:\n' + mcpSummaries.map((s: any) => `- [${s.name}] (${s.status}): ${s.description}`).join('\n')
            : '';

        const builder = new SystemPromptBuilder(BASE_SYSTEM_PROMPT)
            .withRepoMap(this.workspace.getRepoMap())
            .withRoutingHint(decision.systemPromptHint);

        if (memoryHint) builder.withMemoryHint(memoryHint);
        if (catalogAdvert || mcpAdvert) {
            builder.withCatalogAdvert((catalogAdvert + mcpAdvert).trim());
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
                for (const s of parsed.skills) {
                    const skill = this.skillRegistry.getSkill(s.value);
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
                    injectedPrompt
                });

                // Orchestrator 收集汇报
                this.session.addMessage({ role: 'assistant', content: `[Worker @${agentConfig.name} Report]\n${report}` });
                this.daemon?.broadcast('agent:text', `\n[Worker @${agentConfig.name} Report]\n${report}\n`);

                this.workspace.snapshotManager.clearSnapshot(this.session.id);
                this.daemon?.broadcast('agent:done', {});
                return;
            }
        }

        const injection = await this.injector.resolve(parsed, decision, basePrompt, this.session, this.providerResolver);
        if (injection.subagent) {
            console.log(`[Injector] Subagent activated: ${injection.subagent.name}`);
        }

        await this.runLLMLoop(injection);

        // 如果全部完成，清除快照以防下次误报
        this.workspace.snapshotManager.clearSnapshot(this.session.id);
    }

    /**
     * 恢复由于崩溃或手动中断（Ctrl+C）遗留的旧会话。
     * 直接进入带有额外系统提示的 LLM 推理循环。
     */
    public async resumeTask(): Promise<void> {
        console.log(`[Engine] Resuming interrupted session: ${this.session.id}`);

        // Phase 4 & 5 依赖初始化
        await this.workspace.memoryStore.initialize();
        await this.workspace.mcpHost.ensureAutoStartServers();

        // 重新获取 catalog 和 mcp
        const catalogAdvert = this.toolRegistry.getCatalog().getAdvertText();
        const mcpSummaries = this.workspace.mcpHost.getServerSummaries();
        const mcpAdvert = mcpSummaries.length > 0
            ? '\n\nAvailable MCP Servers:\n' + mcpSummaries.map((s: any) => `- [${s.name}] (${s.status}): ${s.description}`).join('\n')
            : '';

        const resumePrompt = new SystemPromptBuilder(BASE_SYSTEM_PROMPT)
            .withRoutingHint('CRITICAL: The previous execution of this session was abruptly interrupted. Review your history context carefully and pick up exactly where you left off.')
            .withCatalogAdvert((catalogAdvert + mcpAdvert).trim())
            .build();

        // 直接发起 LLM Loop 续接
        await this.runLLMLoop({
            systemPrompt: resumePrompt,
            tools: [], // 工具列表在 runLLMLoop 中再组装
            subagent: null as any // 恢复暂不支持 subagent 上下文
        });

        this.workspace.snapshotManager.clearSnapshot(this.session.id);
    }

    /**
     * 核心 LLM 推理循环。接收注入结果，执行多轮工具调用直至完成或重试上限。
     */
    private async runLLMLoop(injection: import('../injector/lazy.js').InjectionResult): Promise<void> {
        let isDone = false;
        let retries = 0;

        while (!isDone && retries < this.maxRetries) {
            try {
                const registryTools = this.toolRegistry.toStandardTools(this.session.activatedTools);
                const mcpTools = this.workspace.mcpHost.getAllTools();
                const allTools = [...registryTools, ...mcpTools, ...injection.tools];

                const prompt: StandardPrompt = {
                    systemPrompt: injection.systemPrompt,
                    messages: this.session.history,
                    tools: allTools,
                };

                const currentToolCall: { id: string; name: string; rawArgs: string } = { id: '', name: '', rawArgs: '' };
                let fullResponseText = '';

                let activeLLM: ILLMProvider;
                if (injection.subagent && injection.subagent.model) {
                    activeLLM = this.providerResolver.getProvider(injection.subagent.model);
                } else {
                    activeLLM = this.providerResolver.getProvider();
                }

                await activeLLM.generateResponseStream(prompt, (event) => {
                    if (event.type === 'text') {
                        fullResponseText += event.data;
                        process.stdout.write(event.data);
                        this.daemon?.broadcast('agent:text', event.data);
                    } else if (event.type === 'tool_call_start') {
                        currentToolCall.id = event.data.id;
                        currentToolCall.name = event.data.name;
                        currentToolCall.rawArgs = '';
                        process.stdout.write(`\n[Agent]: Calling tool "${currentToolCall.name}"...\n`);
                        this.daemon?.broadcast('agent:tool_call', { id: currentToolCall.id, name: currentToolCall.name });
                    } else if (event.type === 'tool_call_chunk') {
                        currentToolCall.rawArgs += event.data;
                    } else if (event.type === 'done') {
                        isDone = true;
                    } else if (event.type === 'error') {
                        console.error('\n[StreamError]:', event.data);
                    }
                });

                if (!currentToolCall.id) {
                    this.session.addMessage({ role: 'assistant', content: fullResponseText });
                    isDone = true;
                    break;
                }

                isDone = false;
                const parsedArgs = currentToolCall.rawArgs ? JSON.parse(currentToolCall.rawArgs) : {};
                this.session.addMessage({
                    role: 'assistant',
                    content: {
                        type: 'tool_call',
                        id: currentToolCall.id,
                        name: currentToolCall.name,
                        arguments: parsedArgs,
                    },
                });

                // Phase 5: 在真正执行 Tool 前，持久化内存现场。防止工具死锁或 OS 宕机。
                this.workspace.snapshotManager.snapshot(this.session);

                const result = await this.executeTool(currentToolCall.name, parsedArgs);
                this.daemon?.broadcast('agent:tool_result', { tool: currentToolCall.name, success: true });
                this.session.addMessage({
                    role: 'user',
                    content: {
                        type: 'tool_result',
                        id: currentToolCall.id,
                        content: result,
                    },
                });

                // Phase 5: 响应也写入快照
                this.workspace.snapshotManager.snapshot(this.session);

            } catch (err: unknown) {
                retries++;
                const message = err instanceof Error ? err.message : String(err);
                console.error(`\n[Engine] Retry ${retries}/${this.maxRetries}: ${message}`);
                this.session.addMessage({
                    role: 'user',
                    content: `System Error: ${message}. Please self-correct or ask the user for help.`,
                });
            }
        }

        if (retries >= this.maxRetries) {
            console.warn('\n[Engine] Max retries reached. Task suspended.');
        }

        this.session.clearActivatedTools();
        this.daemon?.broadcast('agent:done', {});
        this.workspace.reflectionEngine.onSessionComplete({ session: this.session }).catch(() => { });
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

        this.toolRegistry.register(defineTool('readFile', {
            description: 'Read file contents with line numbers. Supports pagination via startLine/maxLines.',
            parameters: z.object({
                filePath: z.string().describe('Path to the file relative to workspace root'),
                startLine: z.number().describe('Starting line number (1-indexed), default 1').optional(),
                maxLines: z.number().describe('Max lines to return, default 500').optional(),
            }),
            async execute(args) {
                const res = aci.readFile(args.filePath, args.startLine, args.maxLines);
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
    }

    private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
        // ── Phase 3: 沙盒审批网关 ──
        const actionType = name === 'readFile' ? 'read_file' : name === 'editFile' ? 'edit_file' : 'run_command';
        const detail = `${name}(${JSON.stringify(args).slice(0, 120)})`;
        const approval = await this.sandbox.requestApproval(actionType as any, detail);

        if (!approval.approved) {
            const reason = approval.reason || 'User denied the action.';
            this.daemon?.broadcast('agent:error', { tool: name, reason });
            return `Action denied by sandbox: ${reason}`;
        }

        try {
            if (name.startsWith('mcp:')) {
                return await this.workspace.mcpHost.callTool(name, args);
            }

            const result = await this.toolRegistry.execute(name, args, {
                sessionId: this.session.id,
                workspaceRoot: process.cwd(),
                session: this.session, // 注入 Session 供按需工具 (useTool) 修改挂载状态
            });
            return result.output;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.daemon?.broadcast('agent:error', { tool: name, error: message });
            return `Error executing "${name}": ${message}`;
        }
    }
}

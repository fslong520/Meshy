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
import { DiagnosticGuard } from '../guard/diagnostic.js';
import { DaemonServer } from '../daemon/server.js';
import { MemoryStore } from '../memory/store.js';
import { ReflectionEngine, FeedbackType } from '../memory/reflection.js';
import { ToolRegistry, createDefaultRegistry, defineTool } from '../tool/index.js';
import { createDefaultToolPackRegistry } from '../tool/tool-pack.js';
import { z } from 'zod';
import { loadConfig } from '../../config/index.js';
import { executeDelegate } from '../tool/delegate-tool.js';

export interface EngineOptions {
    maxRetries?: number;
    executionMode?: ExecutionMode;
    askUser?: AskUserCallback;
    daemon?: DaemonServer;
}

const BASE_SYSTEM_PROMPT = 'You are Meshy, an advanced multi-agent AI assistant. Utilize tools carefully to assist the user.';

export class TaskEngine {
    private providerResolver: ProviderResolver;
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
    private diagnosticGuard: DiagnosticGuard;
    private daemon?: DaemonServer;

    // Phase 4 组件
    private memoryStore: MemoryStore;
    private reflectionEngine: ReflectionEngine;

    // Tool System
    private toolRegistry: ToolRegistry;

    constructor(providerResolver: ProviderResolver, session: Session, options: EngineOptions = {}) {
        this.providerResolver = providerResolver;
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
        this.sandbox = new ExecutionSandbox(options.executionMode || 'smart', askUser);
        this.diagnosticGuard = new DiagnosticGuard();

        // Phase 4 init
        this.memoryStore = new MemoryStore();
        this.reflectionEngine = new ReflectionEngine(this.providerResolver.getProvider(), this.memoryStore);

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
                    '  /clear            — Clear current session',
                    '  /undo             — Roll back last edit',
                    '  /test             — Run tests',
                    '  /compact          — Compress conversation history',
                    '  /help             — Show this help',
                ].join('\n'));
                break;

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
                    const builder = new SystemPromptBuilder(BASE_SYSTEM_PROMPT)
                        .withRoutingHint(decision.systemPromptHint)
                        .withConstraint(constraint);
                    if (catalogAdvert) builder.withCatalogAdvert(catalogAdvert);

                    const basePrompt = builder.build();
                    const injection = await this.injector.resolve(
                        command.args, decision, basePrompt, this.session, this.providerResolver,
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
        await this.memoryStore.initialize();

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
        const memoryHint = await this.reflectionEngine.recallRelevantCapsules(parsed.cleanText);

        // ── Phase 2: 使用 SystemPromptBuilder 组装 Prompt ──
        const catalogAdvert = this.toolRegistry.getCatalog().getAdvertText();
        const builder = new SystemPromptBuilder(BASE_SYSTEM_PROMPT)
            .withRoutingHint(decision.systemPromptHint);

        if (memoryHint) builder.withMemoryHint(memoryHint);
        if (catalogAdvert) builder.withCatalogAdvert(catalogAdvert);

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

        const injection = await this.injector.resolve(userPrompt, decision, basePrompt, this.session, this.providerResolver);
        if (injection.subagent) {
            console.log(`[Injector] Subagent activated: ${injection.subagent.name}`);
        }

        await this.runLLMLoop(injection);
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
                const allTools = [...registryTools, ...injection.tools];

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
                    } else if (event.type === 'tool_call_start') {
                        currentToolCall.id = event.data.id;
                        currentToolCall.name = event.data.name;
                        currentToolCall.rawArgs = '';
                        process.stdout.write(`\n[Agent]: Calling tool "${currentToolCall.name}"...\n`);
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

                const result = await this.executeTool(currentToolCall.name, parsedArgs);
                this.session.addMessage({
                    role: 'user',
                    content: {
                        type: 'tool_result',
                        id: currentToolCall.id,
                        content: result,
                    },
                });

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
        this.reflectionEngine.onSessionComplete({ session: this.session }).catch(() => { });
    }

    /**
     * Phase 4: 接收用户反馈（点赞/踩），触发经验标记与持久化。
     */
    public async submitFeedback(feedback: FeedbackType): Promise<void> {
        await this.reflectionEngine.onUserFeedback(this.session, feedback);
    }

    // ─── ACI 工具注册到 ToolRegistry ───
    private registerAciTools(): void {
        const aci = this.aci;
        const guard = this.diagnosticGuard;
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
                const diagnosticResult = guard.checkContent(args.filePath, simulatedContent);

                if (!diagnosticResult.passed) {
                    const errorMessages = diagnosticResult.diagnostics
                        .filter(d => d.severity === 'error')
                        .map(d => `  Line ${d.line}: ${d.message} (${d.code})`)
                        .join('\n');

                    daemon?.broadcast('agent:error', { tool: 'editFile', diagnostics: diagnosticResult.diagnostics });
                    return {
                        output: `Edit REJECTED by diagnostic guard. ${diagnosticResult.errorCount} error(s):\n${errorMessages}\nPlease fix and retry.`,
                    };
                }

                aci.editFile(args.filePath, args.expectedHash, args.searchBlock, args.replaceBlock);
                daemon?.broadcast('agent:tool_result', { tool: 'editFile', success: true });
                return { output: `Successfully edited ${args.filePath}` };
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

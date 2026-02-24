import { ILLMProvider, StandardPrompt } from '../llm/provider.js';
import { AgentComputerInterface } from '../aci/index.js';
import { Session } from '../session/state.js';
import { IntentRouter } from '../router/intent.js';
import { SkillRegistry } from '../skills/registry.js';
import { SubagentRegistry } from '../subagents/loader.js';
import { LazyInjector } from '../injector/lazy.js';
import { ExecutionSandbox, ExecutionMode, AskUserCallback } from '../sandbox/execution.js';
import { DiagnosticGuard } from '../guard/diagnostic.js';
import { DaemonServer } from '../daemon/server.js';
import { MemoryStore } from '../memory/store.js';
import { ReflectionEngine, FeedbackType } from '../memory/reflection.js';
import { ToolRegistry, createDefaultRegistry, defineTool } from '../tool/index.js';
import { z } from 'zod';
import { loadConfig } from '../../config/index.js';

export interface EngineOptions {
    maxRetries?: number;
    executionMode?: ExecutionMode;
    askUser?: AskUserCallback;
    daemon?: DaemonServer;
}

const BASE_SYSTEM_PROMPT = 'You are Meshy, an advanced multi-agent AI assistant. Utilize tools carefully to assist the user.';

export class TaskEngine {
    private llm: ILLMProvider;
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

    constructor(llm: ILLMProvider, session: Session, options: EngineOptions = {}) {
        this.llm = llm;
        this.session = session;
        this.aci = new AgentComputerInterface();

        const config = loadConfig();
        this.maxRetries = options.maxRetries || config.system.maxRetries || 3;

        // Phase 2 init
        this.router = new IntentRouter();
        this.skillRegistry = new SkillRegistry();
        this.subagentRegistry = new SubagentRegistry();
        this.injector = new LazyInjector(this.skillRegistry, this.subagentRegistry);
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
        this.reflectionEngine = new ReflectionEngine(this.llm, this.memoryStore);

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
     * Main execution loop.
     * Phase 2 增强：先走 IntentRouter 分类，再通过 LazyInjector 动态组装 Prompt 和 Tools。
     */
    public async runTask(userPrompt: string): Promise<void> {
        // Phase 4: 初始化记忆库
        await this.memoryStore.initialize();

        this.session.addMessage({ role: 'user', content: userPrompt });

        // ── Phase 2: 意图路由 ──
        const decision = await this.router.classify(userPrompt);
        console.log(`[Router] Intent: ${decision.intent} | Tier: ${decision.modelTier} | Confidence: ${decision.confidence.toFixed(2)}`);

        // ── Phase 4: 被动召回历史经验 ──
        const memoryHint = await this.reflectionEngine.recallRelevantCapsules(userPrompt);

        // ── Phase 2: 惰性注入 ──
        // 将 ToolCatalog 广告文本附加到 System Prompt，告知 LLM 有哪些按需工具可用
        const catalogAdvert = this.toolRegistry.getCatalog().getAdvertText();
        const promptParts = [BASE_SYSTEM_PROMPT];
        if (memoryHint) promptParts.push(memoryHint);
        if (catalogAdvert) promptParts.push(catalogAdvert);
        const basePrompt = promptParts.join('\n\n');

        const injection = this.injector.resolve(userPrompt, decision, basePrompt);
        if (injection.subagent) {
            console.log(`[Injector] Subagent activated: ${injection.subagent.name}`);
        }

        let isDone = false;
        let retries = 0;

        while (!isDone && retries < this.maxRetries) {
            try {
                // 将 ToolRegistry 工具 + 惰性注入的技能工具合并
                const allTools = [...this.toolRegistry.toStandardTools(), ...injection.tools];

                const prompt: StandardPrompt = {
                    systemPrompt: injection.systemPrompt,
                    messages: this.session.history,
                    tools: allTools,
                };

                const currentToolCall: { id: string; name: string; rawArgs: string } = { id: '', name: '', rawArgs: '' };
                let fullResponseText = '';

                await this.llm.generateResponseStream(prompt, (event) => {
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

                // 如果模型只给了纯文本回复（无 Tool Call），结束循环
                if (!currentToolCall.id) {
                    this.session.addMessage({ role: 'assistant', content: fullResponseText });
                    isDone = true;
                    break;
                }

                // 记录 Tool Call 到 Session
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

                // 执行工具
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

        // ── Phase 4: 异步经验萃取（不阻塞主流程） ──
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
            });
            return result.output;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.daemon?.broadcast('agent:error', { tool: name, error: message });
            return `Error executing "${name}": ${message}`;
        }
    }
}

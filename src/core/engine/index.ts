import { ILLMProvider, StandardPrompt } from '../llm/provider.js';
import { AgentComputerInterface } from '../aci/index.js';
import { Session } from '../session/state.js';
import { IntentRouter } from '../router/intent.js';
import { SkillRegistry } from '../skills/registry.js';
import { SubagentRegistry } from '../subagents/loader.js';
import { LazyInjector } from '../injector/lazy.js';
import { loadConfig } from '../../config/index.js';

export interface EngineOptions {
    maxRetries?: number;
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

    constructor(llm: ILLMProvider, session: Session, options: EngineOptions = {}) {
        this.llm = llm;
        this.session = session;
        this.aci = new AgentComputerInterface();

        const config = loadConfig();
        this.maxRetries = options.maxRetries || config.system.maxRetries || 3;

        // 初始化 Phase 2 组件
        this.router = new IntentRouter();
        this.skillRegistry = new SkillRegistry();
        this.subagentRegistry = new SubagentRegistry();
        this.injector = new LazyInjector(this.skillRegistry, this.subagentRegistry);

        // 启动时扫描技能与子智能体目录
        this.skillRegistry.scan();
        this.subagentRegistry.scan();
    }

    /**
     * Main execution loop.
     * Phase 2 增强：先走 IntentRouter 分类，再通过 LazyInjector 动态组装 Prompt 和 Tools。
     */
    public async runTask(userPrompt: string): Promise<void> {
        this.session.addMessage({ role: 'user', content: userPrompt });

        // ── Phase 2: 意图路由 ──
        const decision = await this.router.classify(userPrompt);
        console.log(`[Router] Intent: ${decision.intent} | Tier: ${decision.modelTier} | Confidence: ${decision.confidence.toFixed(2)}`);

        // ── Phase 2: 惰性注入 ──
        const injection = this.injector.resolve(userPrompt, decision, BASE_SYSTEM_PROMPT);
        if (injection.subagent) {
            console.log(`[Injector] Subagent activated: ${injection.subagent.name}`);
        }

        let isDone = false;
        let retries = 0;

        while (!isDone && retries < this.maxRetries) {
            try {
                // 将 ACI 基础工具 + 惰性注入的技能工具合并
                const allTools = [...this.getBaseTools(), ...injection.tools];

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
    }

    // ─── ACI 基础工具（常驻上下文） ───
    private getBaseTools() {
        return [
            {
                name: 'readFile',
                description: 'Read file contents with line numbers. Supports pagination via startLine/maxLines.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: 'Path to the file relative to workspace root' },
                        startLine: { type: 'number', description: 'Starting line number (1-indexed), default 1' },
                        maxLines: { type: 'number', description: 'Max lines to return, default 500' },
                    },
                    required: ['filePath'],
                },
            },
            {
                name: 'editFile',
                description: 'Replace a specific text block in a file. Requires expectedHash from a prior readFile call to prevent conflicts.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                        expectedHash: { type: 'string', description: 'SHA-256 hash from readFile to guard concurrency' },
                        searchBlock: { type: 'string', description: 'Exact text to find' },
                        replaceBlock: { type: 'string', description: 'Replacement text' },
                    },
                    required: ['filePath', 'expectedHash', 'searchBlock', 'replaceBlock'],
                },
            },
        ];
    }

    private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
        try {
            if (name === 'readFile') {
                const res = this.aci.readFile(
                    args.filePath as string,
                    (args.startLine as number) || undefined,
                    (args.maxLines as number) || undefined
                );
                return JSON.stringify(res);
            }

            if (name === 'editFile') {
                this.aci.editFile(
                    args.filePath as string,
                    args.expectedHash as string,
                    args.searchBlock as string,
                    args.replaceBlock as string
                );
                return `Successfully edited ${args.filePath}`;
            }

            return `Error: Unknown tool "${name}".`;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return `Error executing "${name}": ${message}`;
        }
    }
}

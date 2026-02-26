import { ILLMProvider, StandardPrompt, StandardTool } from '../llm/provider.js';
import { ProviderResolver } from '../llm/resolver.js';
import { SubagentConfig } from '../subagents/loader.js';
import { Session } from '../session/state.js';
import { ToolRegistry } from '../tool/registry.js';
import { Workspace } from '../workspace/workspace.js';
import { SystemPromptBuilder } from '../router/prompt-builder.js';
import { SecurityGuard } from '../security/guard.js';
import { ExecutionMode } from '../security/modes.js';

export interface WorkerOptions {
    parentSession?: Session;
    /** 最大历史回溯条数，用于优化上下文 */
    maxContextMessages?: number;
    /** 用户显式加载注入的额外工具 */
    injectedTools?: StandardTool[];
    /** 用户显式加载的额外 Prompt (如技能 Markdown Body) */
    injectedPrompt?: string;
}

/**
 * Ephemeral Worker Agent
 * 
 * 临时实例化的子智能体，专用于完成受限上下文的明确任务。
 * 它包含完整的 LLM Tool Execution Loop，但拥有与主进程隔离的 Session。
 */
export class WorkerAgent {
    public readonly session: Session;
    private maxRetries = 10;
    private securityGuard: SecurityGuard;

    constructor(
        private config: SubagentConfig,
        private workspace: Workspace,
        private toolRegistry: ToolRegistry,
        private providerResolver: ProviderResolver,
        securityGuard?: SecurityGuard,
    ) {
        this.session = new Session(`worker-${config.name}-${Date.now()}`);
        this.securityGuard = securityGuard ?? new SecurityGuard(ExecutionMode.SMART);
    }

    /**
     * 执行隔离的子任务，并返回结构化的结果报告。
     */
    public async execute(taskDescription: string, options?: WorkerOptions): Promise<string> {
        console.log(`\n[WorkerAgent] Starting ephemeral worker: @${this.config.name}`);

        // 1. 构建精简的局部上下文 (Local Context)
        if (options?.parentSession) {
            const limit = options.maxContextMessages ?? this.config.maxContextMessages ?? 6;
            const recentHistory = options.parentSession.history.slice(-limit);
            for (const msg of recentHistory) {
                this.session.addMessage(msg); // 注入局部历史，避免主线程长上下文污染
            }
        }

        // 追加明确的单一任务指令
        this.session.addMessage({ role: 'user', content: taskDescription });

        // 2. 组装专有 System Prompt
        const builder = new SystemPromptBuilder('You are an ephemeral specialized worker agent. Focus entirely on the assigned task.')
            .withPersona(this.config.systemPrompt)
            .withConstraint('Complete the task description accurately and return the final report.');

        if (this.config.reportFormat === 'json') {
            builder.withConstraint('Return your final result formatted strictly as JSON.');
        }

        const systemPrompt = builder.build() + (options?.injectedPrompt ? `\n\n${options.injectedPrompt}` : '');

        // 3. 裁剪工具白名单
        const allTools = this.toolRegistry.toStandardTools();
        const hasWhitelist = this.config.allowedTools && this.config.allowedTools.length > 0;
        const whitelistSet = new Set(this.config.allowedTools || []);

        const filteredTools = hasWhitelist
            ? allTools.filter(t => whitelistSet.has(t.name))
            : allTools;

        // 也允许使用部分 MCP 外部工具（如配置允许，这里默认挂载）加上手动注入的 tools
        const mcpTools = this.workspace.mcpHost.getAllTools();
        const userInjectedTools = options?.injectedTools || [];

        // 为了去重，基于工具 name 过滤
        const combinedToolsMap = new Map<string, StandardTool>();
        for (const t of [...filteredTools, ...mcpTools, ...userInjectedTools]) {
            combinedToolsMap.set(t.name, t);
        }
        const combinedTools = Array.from(combinedToolsMap.values());

        // 4. 执行受限的 Tool Loop
        let isDone = false;
        let retries = 0;
        let finalReport = '';

        const llm: ILLMProvider = this.providerResolver.getProvider(this.config.model);

        while (!isDone && retries < this.maxRetries) {
            try {
                const prompt: StandardPrompt = {
                    systemPrompt,
                    messages: this.session.history,
                    tools: combinedTools,
                };

                const currentToolCall = { id: '', name: '', rawArgs: '' };
                let responseText = '';

                await llm.generateResponseStream(prompt, (event) => {
                    if (event.type === 'text') {
                        responseText += event.data;
                        // Worker 输出加前缀或者只留在后台
                        process.stdout.write(event.data);
                    } else if (event.type === 'tool_call_start') {
                        currentToolCall.id = event.data.id;
                        currentToolCall.name = event.data.name;
                        currentToolCall.rawArgs = '';
                        process.stdout.write(`\n[Worker @${this.config.name}]: Calling tool "${currentToolCall.name}"...\n`);
                    } else if (event.type === 'tool_call_chunk') {
                        currentToolCall.rawArgs += event.data;
                    } else if (event.type === 'done') {
                        // isDone handles stream completion
                    } else if (event.type === 'error') {
                        console.error('\n[Worker StreamError]:', event.data);
                    }
                });

                if (!currentToolCall.id) {
                    // 没有更多工具调用，工作完成
                    this.session.addMessage({ role: 'assistant', content: responseText });
                    finalReport = responseText;
                    isDone = true;
                    break;
                }

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

                // 执行工具逻辑
                const toolResult = await this.executeToolSilently(currentToolCall.name, parsedArgs);
                this.session.addMessage({
                    role: 'user',
                    content: {
                        type: 'tool_result',
                        id: currentToolCall.id,
                        content: toolResult,
                    },
                });

            } catch (err: unknown) {
                retries++;
                const message = err instanceof Error ? err.message : String(err);
                console.error(`\n[Worker] Error: ${message}. Retrying...`);
                this.session.addMessage({
                    role: 'user',
                    content: `System Error: ${message}. Please self-correct.`,
                });
            }
        }

        console.log(`\n[WorkerAgent] @${this.config.name} execution completed.`);
        return finalReport || 'Worker failed to produce a valid report.';
    }

    private async executeToolSilently(name: string, args: Record<string, unknown>): Promise<string> {
        // Phase 11: SecurityGuard check
        const decision = this.securityGuard.evaluate(name, args as Record<string, any>);
        if (!decision.allowed && !decision.requiresApproval) {
            console.warn(`[Worker SecurityGuard] Blocked: ${decision.reason}`);
            return `Action blocked by SecurityGuard: ${decision.reason}`;
        }
        if (!decision.allowed && decision.requiresApproval) {
            // In Worker context, we auto-reject actions needing approval (Workers should not pause)
            console.warn(`[Worker SecurityGuard] Rejected (requires approval, not available in Worker): ${decision.reason}`);
            return `Action rejected: Worker agents cannot request user approval. ${decision.reason}`;
        }

        try {
            if (name.startsWith('mcp:')) {
                return await this.workspace.mcpHost.callTool(name, args);
            }
            const result = await this.toolRegistry.execute(name, args, {
                sessionId: this.session.id,
                workspaceRoot: process.cwd(),
                session: this.session,
            });
            return result.output;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return `Error executing "${name}": ${message}`;
        }
    }
}

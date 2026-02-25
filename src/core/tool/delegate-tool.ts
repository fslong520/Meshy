/**
 * DelegateToAgent Tool — Manager → Subagent 委派工具
 *
 * 允许 Manager Agent 将子任务委派给特定的 Subagent：
 * 1. 从 SubagentRegistry 获取配置
 * 2. 创建隔离的临时 Session（仅含任务描述 + 最近 N 条历史）
 * 3. 用 SystemPromptBuilder 组装 Subagent 专用 Prompt
 * 4. 执行单轮推理，捕获最终文本回复
 * 5. 将结果作为 Tool Result 返回给 Manager
 * 6. 销毁临时 Session
 *
 * 参考 OpenCode 的 task.ts 工具设计。
 */

import { SubagentRegistry } from '../subagents/loader.js';
import { ProviderResolver } from '../llm/resolver.js';
import { Session } from '../session/state.js';
import { SystemPromptBuilder } from '../router/prompt-builder.js';
import { ToolRegistry } from '../tool/registry.js';
import { ILLMProvider, StandardPrompt, StandardMessage } from '../llm/provider.js';

const BASE_SUBAGENT_PROMPT = 'You are a specialized sub-agent. Complete the assigned task precisely and return a structured response.';

export interface DelegateArgs {
    agentName: string;
    taskDescription: string;
}

export interface DelegateResult {
    agentName: string;
    response: string;
    success: boolean;
}

/**
 * 执行委派逻辑（不依赖 defineTool，由 TaskEngine 自行封装注册）。
 */
export async function executeDelegate(
    args: DelegateArgs,
    context: {
        subagentRegistry: SubagentRegistry;
        providerResolver: ProviderResolver;
        toolRegistry: ToolRegistry;
        parentSession: Session;
    },
): Promise<DelegateResult> {
    const { subagentRegistry, providerResolver, toolRegistry, parentSession } = context;

    // 1. 查找 Subagent
    const agent = subagentRegistry.getAgent(args.agentName);
    if (!agent) {
        return {
            agentName: args.agentName,
            response: `Agent "${args.agentName}" not found. Available: ${subagentRegistry.listAgents().map(a => a.name).join(', ')}`,
            success: false,
        };
    }

    // 2. 创建隔离 Session（裁剪上下文）
    const tempSession = new Session(`delegate-${agent.name}-${Date.now()}`);

    // 仅注入最近 N 条消息作为背景
    const recentHistory = parentSession.history.slice(-agent.maxContextMessages);
    for (const msg of recentHistory) {
        tempSession.addMessage(msg);
    }
    tempSession.addMessage({ role: 'user', content: args.taskDescription });

    // 3. 组装 Prompt
    const builder = new SystemPromptBuilder(BASE_SUBAGENT_PROMPT)
        .withPersona(agent.systemPrompt)
        .withConstraint(`You must complete this task: ${args.taskDescription}`);

    if (agent.reportFormat === 'json') {
        builder.withConstraint('Return your response as a valid JSON object.');
    }

    // 4. 准备工具列表（按白名单裁剪）
    const allTools = toolRegistry.toStandardTools();
    const hasWhitelist = agent.allowedTools.length > 0;
    const whitelistSet = new Set(agent.allowedTools);
    const filteredTools = hasWhitelist
        ? allTools.filter(t => whitelistSet.has(t.name))
        : allTools;

    // 5. 获取模型并执行推理
    const llm: ILLMProvider = providerResolver.getProvider(agent.model);
    const prompt: StandardPrompt = {
        systemPrompt: builder.build(),
        messages: tempSession.history,
        tools: filteredTools,
    };

    let responseText = '';

    try {
        await llm.generateResponseStream(prompt, (event) => {
            if (event.type === 'text') {
                responseText += event.data;
            }
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            agentName: agent.name,
            response: `Delegate failed: ${message}`,
            success: false,
        };
    }

    // 6. 返回结果（临时 Session 自动被 GC 回收）
    return {
        agentName: agent.name,
        response: responseText || '(empty response)',
        success: true,
    };
}

/**
 * Tool Definition Framework — 类型安全的工具定义器
 *
 * 参考 OpenCode 的 Tool.define() 模式：
 * - 每个工具声明 id, description, parameters(Zod), execute 函数
 * - 框架层自动做 Zod 参数校验，校验失败直接返回错误（不调用 execute）
 * - 统一的 ToolContext 上下文传递
 */

import { z } from 'zod';

import { Session } from '../session/state.js';

// ─── 工具执行上下文 ───
export interface ToolContext {
    sessionId: string;
    workspaceRoot: string;
    session?: Session; // 注入 Session 实例，供 useTool 写入状态
    abort?: AbortSignal;
}

// ─── 工具执行结果 ───
export interface ToolResult {
    output: string;
    isError?: boolean;
    metadata?: Record<string, unknown>;
}

// ─── 工具定义结构 ───
export interface ToolDefinition<P extends z.ZodType = z.ZodType> {
    id: string;
    description: string;
    parameters: P;
    execute: (args: z.infer<P>, ctx: ToolContext) => Promise<ToolResult>;
}

/**
 * Tool.define — 创建一个类型安全的工具定义。
 * 框架层会在调用 execute 之前自动用 Zod 校验参数。
 */
export function defineTool<P extends z.ZodType>(
    id: string,
    init: {
        description: string;
        parameters: P;
        execute: (args: z.infer<P>, ctx: ToolContext) => Promise<ToolResult>;
    },
): ToolDefinition<P> {
    const originalExecute = init.execute;

    return {
        id,
        description: init.description,
        parameters: init.parameters,
        execute: async (args: z.infer<P>, ctx: ToolContext): Promise<ToolResult> => {
            // Zod 参数校验
            const parsed = init.parameters.safeParse(args);
            if (!parsed.success) {
                const issues = parsed.error.issues
                    .map(i => `  - ${i.path.join('.')}: ${i.message}`)
                    .join('\n');
                return {
                    output: `Tool "${id}" received invalid arguments:\n${issues}\nPlease fix and retry.`,
                    isError: true,
                };
            }

            return originalExecute(parsed.data, ctx);
        },
    };
}

/**
 * ToolRegistry — 工具注册表与统一调度器
 *
 * 聚合所有内置工具 + 技能工具 + MCP 工具，
 * 输出标准化的 StandardTool[] 给 LLM，并提供 execute() 统一调度。
 */

import { ToolDefinition, ToolContext, ToolResult } from './define.js';
import { StandardTool } from '../llm/provider.js';
import { zodToJsonSchema } from './schema-util.js';

export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();

    /**
     * 注册一个工具。同名会覆盖。
     */
    public register(tool: ToolDefinition): void {
        this.tools.set(tool.id, tool);
    }

    /**
     * 批量注册工具。
     */
    public registerAll(tools: ToolDefinition[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    /**
     * 将所有注册工具转换为 StandardTool[] 格式（给 LLM payload 用）。
     */
    public toStandardTools(): StandardTool[] {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.id,
            description: tool.description,
            inputSchema: zodToJsonSchema(tool.parameters),
        }));
    }

    /**
     * 统一调度入口：根据工具名执行。
     */
    public async execute(
        name: string,
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return { output: `Error: Unknown tool "${name}".` };
        }

        return tool.execute(args, ctx);
    }

    /**
     * 检查某个工具是否已注册。
     */
    public has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * 获取所有已注册工具的 ID 列表。
     */
    public ids(): string[] {
        return Array.from(this.tools.keys());
    }
}

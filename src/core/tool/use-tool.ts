/**
 * UseTool — 按需加载工具的元工具
 *
 * LLM 调用 `useTool("lsp_goto_definition")` →
 * 系统从 ToolCatalog 中查找完整定义 →
 * 将该工具的完整 Schema 作为结果返回给 LLM →
 * 将激活状态写入当前 Session 中，下一轮 LLM 即可直接调用该工具。
 */

import { z } from 'zod';
import { defineTool, ToolDefinition } from './define.js';
import { ToolCatalog } from './catalog.js';
import { zodToJsonSchema } from './schema-util.js';

export function createUseToolDefinition(catalog: ToolCatalog): ToolDefinition {
    return defineTool('useTool', {
        description: [
            'Activate and load an extra tool from the tool catalog.',
            'Call this with the toolName from the catalog to make it available for use.',
            'After activation, you can call the tool directly in subsequent turns.',
            'Use this when you need a specialized tool (LSP, MCP, etc.) that is not built-in.',
        ].join('\n'),
        parameters: z.object({
            toolName: z.string().describe('The tool ID from the catalog to activate'),
        }),
        async execute(params, ctx) {
            if (!ctx.session) {
                return { output: `Internal Error: No active session to bind tool "${params.toolName}".` };
            }

            const tool = catalog.lookupDefinition(params.toolName);

            if (!tool) {
                // 尝试模糊匹配 (移除 slice 限制，全部返回，让 LLM 做主)
                const allEntries = catalog.getAllEntries();
                const suggestions = allEntries
                    .filter(e => e.id.includes(params.toolName) || params.toolName.includes(e.id))
                    .map(e => `  - ${e.id} (${e.brief})`);

                const hint = suggestions.length > 0
                    ? `\n\nDid you mean one of these?\n${suggestions.join('\n')}`
                    : `\n\nAvailable categories: ${[...new Set(allEntries.map(e => e.category))].join(', ')}`;

                return {
                    output: `Tool "${params.toolName}" not found in catalog.${hint}`,
                };
            }

            // 写入 Session 状态
            ctx.session.activateTool(tool.id);

            // 返回工具的完整 Schema，供 LLM 在下一轮使用
            const schema = zodToJsonSchema(tool.parameters);

            return {
                output: [
                    `✅ Tool "${tool.id}" activated successfully for this session. You can now call it directly.`,
                    '',
                    `Tool: ${tool.id}`,
                    `Description: ${tool.description}`,
                    `Parameters: ${JSON.stringify(schema, null, 2)}`,
                ].join('\n'),
                metadata: { activated: tool.id },
            };
        },
    });
}

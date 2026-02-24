/**
 * UseTool — 按需加载工具的元工具
 *
 * LLM 调用 `useTool("lsp_goto_definition")` →
 * 系统从 ToolCatalog 中查找完整定义 →
 * 将该工具的完整 Schema 作为结果返回给 LLM →
 * 下一轮 LLM 即可直接调用该工具。
 *
 * 这个工具本身是 Built-in 常驻的，但它激活的目标工具是按需加载的。
 */

import { z } from 'zod';
import { defineTool, ToolDefinition } from './define.js';
import { ToolCatalog } from './catalog.js';
import { zodToJsonSchema } from './schema-util.js';

/**
 * 创建 useTool 定义。
 * 需要注入 ToolCatalog 引用，所以用工厂函数。
 */
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
        async execute(params) {
            const tool = catalog.activate(params.toolName);

            if (!tool) {
                // 尝试模糊匹配
                const allEntries = catalog.getAllEntries();
                const suggestions = allEntries
                    .filter(e => e.id.includes(params.toolName) || params.toolName.includes(e.id))
                    .map(e => `  - ${e.id} (${e.brief})`)
                    .slice(0, 5);

                const hint = suggestions.length > 0
                    ? `\n\nDid you mean one of these?\n${suggestions.join('\n')}`
                    : `\n\nAvailable categories: ${[...new Set(allEntries.map(e => e.category))].join(', ')}`;

                return {
                    output: `Tool "${params.toolName}" not found in catalog.${hint}`,
                };
            }

            // 返回工具的完整 Schema，供 LLM 在下一轮使用
            const schema = zodToJsonSchema(tool.parameters);

            return {
                output: [
                    `✅ Tool "${tool.id}" activated successfully. You can now call it directly.`,
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

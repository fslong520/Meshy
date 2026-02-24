/**
 * Tool System — Barrel Export
 *
 * 双层架构：
 * - Built-in 工具（常驻注入 LLM context）
 * - Lazy 工具（按需加载，通过 ToolCatalog + useTool 激活）
 */

export { defineTool, type ToolDefinition, type ToolContext, type ToolResult } from './define.js';
export { ToolRegistry } from './registry.js';
export { ToolCatalog, type CatalogEntry } from './catalog.js';
export { createManageToolsDefinition } from './manage-tools.js';
export { zodToJsonSchema } from './schema-util.js';

// Built-in Tools
export { BashTool } from './bash.js';
export { WriteTool } from './write.js';
export { GlobTool } from './glob.js';
export { GrepTool } from './grep.js';
export { LsTool } from './ls.js';
export { WebFetchTool } from './webfetch.js';
export { WebSearchTool } from './websearch.js';

import { ToolRegistry } from './registry.js';
import { ToolCatalog } from './catalog.js';
import { createManageToolsDefinition } from './manage-tools.js';
import { BashTool } from './bash.js';
import { WriteTool } from './write.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { LsTool } from './ls.js';
import { WebFetchTool } from './webfetch.js';
import { WebSearchTool } from './websearch.js';

/**
 * 创建一个预注册了所有内置工具的 ToolRegistry 实例。
 * 包含 ToolCatalog 和 manageTools 元工具。
 */
export function createDefaultRegistry(): ToolRegistry {
    const catalog = new ToolCatalog();
    const registry = new ToolRegistry(catalog);

    // 注册 9 个 Built-in 常驻工具
    registry.registerAll([
        BashTool,
        WriteTool,
        GlobTool,
        GrepTool,
        LsTool,
        WebFetchTool,
        WebSearchTool,
    ]);

    // 注册 manageTools 元工具（用于管理 Catalog 中的按需工具）
    registry.register(createManageToolsDefinition(catalog));

    return registry;
}

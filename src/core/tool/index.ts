/**
 * Tool System — Barrel Export
 *
 * 三层架构：
 * - Built-in 工具（常驻注入 LLM context）
 * - ToolPack 预设包（确定性快速路径）
 * - ToolRAG + Lazy 工具（按需 BM25 检索 / manageTools 管理）
 */

export { defineTool, type ToolDefinition, type ToolContext, type ToolResult } from './define.js';
export { ToolRegistry } from './registry.js';
export { ToolCatalog, type CatalogEntry } from './catalog.js';
export { ToolRAGIndex, type ToolDocument } from './tool-rag.js';
export { ToolPackRegistry, createDefaultToolPackRegistry, type ToolPack } from './tool-pack.js';
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
import { createBlackboardTools } from './builtin/board.js';

/**
 * 创建一个预注册了所有内置工具的 ToolRegistry 实例。
 * 包含 ToolCatalog（内置 ToolRAGIndex）和 manageTools 元工具。
 */
export function createDefaultRegistry(): ToolRegistry {
    const catalog = new ToolCatalog(); // 自动创建内部 ToolRAGIndex
    const registry = new ToolRegistry(catalog);

    registry.registerAll([
        BashTool,
        WriteTool,
        GlobTool,
        GrepTool,
        LsTool,
        WebFetchTool,
        WebSearchTool,
    ]);

    // manageTools 接收 catalog 和 ragIndex
    registry.register(createManageToolsDefinition(catalog, catalog.getRagIndex()));

    // Phase 10: 协作黑板工具（常驻可用）
    registry.registerAll(createBlackboardTools());

    return registry;
}


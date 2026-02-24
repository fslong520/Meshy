/**
 * Tool System — Barrel Export
 *
 * 统一导出所有工具定义、注册表和内置工具。
 */

export { defineTool, type ToolDefinition, type ToolContext, type ToolResult } from './define.js';
export { ToolRegistry } from './registry.js';
export { zodToJsonSchema } from './schema-util.js';

// Built-in Tools
export { BashTool } from './bash.js';
export { WriteTool } from './write.js';
export { GlobTool } from './glob.js';
export { GrepTool } from './grep.js';
export { LsTool } from './ls.js';

import { ToolRegistry } from './registry.js';
import { BashTool } from './bash.js';
import { WriteTool } from './write.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { LsTool } from './ls.js';

/**
 * 创建一个预注册了所有内置工具的 ToolRegistry 实例。
 */
export function createDefaultRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.registerAll([BashTool, WriteTool, GlobTool, GrepTool, LsTool]);
    return registry;
}

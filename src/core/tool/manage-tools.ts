/**
 * ManageTools — 全局工具包管理器 (Meta-Tool)
 *
 * 允许 LLM 针对按需加载的（Lazy）工具进行批量激活、解绑、查询和列举。
 * 受限于 Session LRU 容量（如最长 15 个），LLM 需要主动打理自己的工具腰带。
 */

import { z } from 'zod';
import { defineTool, ToolDefinition } from './define.js';
import { ToolCatalog } from './catalog.js';
import { zodToJsonSchema } from './schema-util.js';

export function createManageToolsDefinition(catalog: ToolCatalog): ToolDefinition {
    return defineTool('manageTools', {
        description: [
            'Manage the advanced tools in your toolbelt (LSP, MCP, etc.) for this session.',
            'Actions:',
            '  - "search": Find available tools by keyword.',
            '  - "activate": Batch load tools by providing toolIds or categories.',
            '  - "deactivate": Remove tools from your toolbelt to free up capacity.',
            '  - "list_active": See what lazy tools are currently in your toolbelt.',
            'Note: Your toolbelt has a strict LRU capacity limit (e.g., 15 tools). If you load too many, the oldest ones will be evicted automatically.',
        ].join('\n'),
        parameters: z.object({
            action: z.enum(['search', 'activate', 'deactivate', 'list_active'])
                .describe('The management action to perform.'),
            keywords: z.string().describe('Keywords to search for (used with "search").').optional(),
            toolIds: z.array(z.string()).describe('Array of tool IDs to activate/deactivate.').optional(),
            categories: z.array(z.string()).describe('Array of categories. All tools in these categories will be activated. (used with "activate").').optional(),
        }),
        async execute(params, ctx) {
            const session = ctx.session;
            if (!session) {
                return { output: `Internal Error: No active session to manage tools.` };
            }

            switch (params.action) {
                case 'search': {
                    const kw = (params.keywords || '').toLowerCase();
                    const hits = catalog.getAllEntries().filter(
                        e => e.id.toLowerCase().includes(kw) || e.brief.toLowerCase().includes(kw)
                    );

                    if (hits.length === 0) {
                        return { output: `No tools found matching "${kw}".` };
                    }

                    return {
                        output: `Search Results for "${kw}":\n` + hits.map(e => `  - [${e.category}] ${e.id}: ${e.brief}`).join('\n')
                    };
                }

                case 'activate': {
                    const toActivate = new Set<string>();

                    // 1. 根据 category 收集
                    if (params.categories) {
                        for (const cat of params.categories) {
                            catalog.getByCategory(cat).forEach(e => toActivate.add(e.id));
                        }
                    }

                    // 2. 根据 toolIds 收集
                    if (params.toolIds) {
                        for (const id of params.toolIds) {
                            if (catalog.lookupDefinition(id)) {
                                toActivate.add(id);
                            } else {
                                return { output: `Error: Tool ID "${id}" does not exist in catalog. Use "search" to find valid IDs.` };
                            }
                        }
                    }

                    if (toActivate.size === 0) {
                        return { output: 'No valid toolIds or categories provided to activate.' };
                    }

                    const schemas: Record<string, unknown> = {};
                    for (const id of toActivate) {
                        session.activateTool(id);
                        const def = catalog.lookupDefinition(id)!;
                        schemas[id] = {
                            description: def.description,
                            parameters: zodToJsonSchema(def.parameters),
                        };
                    }

                    return {
                        output: [
                            `✅ Successfully activated ${toActivate.size} tools for this session. They will be available in the next turn.`,
                            '',
                            `Activated Schemas:`,
                            JSON.stringify(schemas, null, 2),
                        ].join('\n'),
                    };
                }

                case 'deactivate': {
                    if (!params.toolIds || params.toolIds.length === 0) {
                        return { output: 'Must provide an array of toolIds to deactivate.' };
                    }

                    const deactivated: string[] = [];
                    for (const id of params.toolIds) {
                        if (session.activatedTools.has(id)) {
                            session.deactivateTool(id);
                            deactivated.push(id);
                        }
                    }

                    if (deactivated.length === 0) {
                        return { output: 'None of the provided toolIds were currently active.' };
                    }

                    return { output: `✅ Successfully deactivated: ${deactivated.join(', ')}` };
                }

                case 'list_active': {
                    const activeCount = session.activatedTools.size;
                    if (activeCount === 0) {
                        return { output: 'Your toolbelt is currently empty (0 lazy tools active).' };
                    }

                    const activeList = Array.from(session.activatedTools).map(id => {
                        const def = catalog.lookupDefinition(id);
                        return `  - ${id}${def ? ` (${def.description.split('\n')[0]})` : ''}`;
                    });

                    return {
                        output: `Currently active lazy tools (${activeCount}):\n` + activeList.join('\n')
                    };
                }

                default:
                    return { output: `Unknown action: ${params.action}` };
            }
        },
    });
}

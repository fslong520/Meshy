/**
 * ManageTools — 全局工具包管理器 (Meta-Tool)
 *
 * 允许 LLM 针对按需加载的（Lazy）工具进行批量激活、解绑、钉住、查询和列举。
 * 使用 ToolRAG 语义检索替代简单关键词匹配。
 */

import { z } from 'zod';
import { defineTool, ToolDefinition } from './define.js';
import { ToolCatalog } from './catalog.js';
import { ToolRAGIndex } from './tool-rag.js';
import { zodToJsonSchema } from './schema-util.js';

export function createManageToolsDefinition(
    catalog: ToolCatalog,
    ragIndex: ToolRAGIndex,
): ToolDefinition {
    return defineTool('manageTools', {
        description: [
            'Manage the advanced tools in your toolbelt (LSP, MCP, etc.) for this session.',
            'Actions:',
            '  - "search": Find available tools by keyword (uses semantic search).',
            '  - "activate": Batch load tools by providing toolIds or categories.',
            '  - "deactivate": Remove tools from your active set.',
            '  - "pin": Pin tools so they persist across turns (not affected by per-turn retrieval).',
            '  - "unpin": Unpin previously pinned tools.',
            '  - "list_active": See what lazy tools are currently active (pinned + retrieved).',
        ].join('\n'),
        parameters: z.object({
            action: z.enum(['search', 'activate', 'deactivate', 'pin', 'unpin', 'list_active'])
                .describe('The management action to perform.'),
            keywords: z.string().describe('Keywords to search for (used with "search").').optional(),
            toolIds: z.array(z.string()).describe('Array of tool IDs.').optional(),
            categories: z.array(z.string()).describe('Array of categories (used with "activate").').optional(),
        }),
        async execute(params, ctx) {
            const session = ctx.session;
            if (!session) {
                return { output: `Internal Error: No active session to manage tools.` };
            }

            switch (params.action) {
                case 'search': {
                    const kw = params.keywords || '';
                    // 优先使用 BM25 语义检索
                    const ragHits = ragIndex.size > 0
                        ? ragIndex.search(kw, 15)
                        : [];

                    if (ragHits.length > 0) {
                        const results = ragHits.map(id => {
                            const entry = catalog.getAllEntries().find(e => e.id === id);
                            return entry
                                ? `  - [${entry.category}] ${id}: ${entry.brief}`
                                : `  - ${id}`;
                        });
                        return { output: `Search Results (${ragHits.length} hits):\n${results.join('\n')}` };
                    }

                    // 回退到简单字符串匹配
                    const kwLower = kw.toLowerCase();
                    const fallbackHits = catalog.getAllEntries().filter(
                        e => e.id.toLowerCase().includes(kwLower) || e.brief.toLowerCase().includes(kwLower),
                    );

                    if (fallbackHits.length === 0) {
                        return { output: `No tools found matching "${kw}".` };
                    }

                    return {
                        output: `Search Results for "${kw}":\n` +
                            fallbackHits.map(e => `  - [${e.category}] ${e.id}: ${e.brief}`).join('\n'),
                    };
                }

                case 'activate': {
                    const toActivate = new Set<string>();

                    if (params.categories) {
                        for (const cat of params.categories) {
                            catalog.getByCategory(cat).forEach(e => toActivate.add(e.id));
                        }
                    }

                    if (params.toolIds) {
                        for (const id of params.toolIds) {
                            if (catalog.lookupDefinition(id)) {
                                toActivate.add(id);
                            } else {
                                return { output: `Error: Tool ID "${id}" does not exist in catalog.` };
                            }
                        }
                    }

                    if (toActivate.size === 0) {
                        return { output: 'No valid toolIds or categories provided.' };
                    }

                    const schemas: Record<string, unknown> = {};
                    for (const id of toActivate) {
                        session.pinTool(id); // activate = pin for explicit request
                        const def = catalog.lookupDefinition(id)!;
                        schemas[id] = {
                            description: def.description,
                            parameters: zodToJsonSchema(def.parameters),
                        };
                    }

                    return {
                        output: [
                            `✅ Activated and pinned ${toActivate.size} tools. Available in the next turn.`,
                            '',
                            JSON.stringify(schemas, null, 2),
                        ].join('\n'),
                    };
                }

                case 'deactivate': {
                    if (!params.toolIds?.length) {
                        return { output: 'Must provide toolIds to deactivate.' };
                    }

                    const removed: string[] = [];
                    for (const id of params.toolIds) {
                        session.deactivateTool(id);
                        removed.push(id);
                    }

                    return { output: `✅ Deactivated: ${removed.join(', ')}` };
                }

                case 'pin': {
                    if (!params.toolIds?.length) {
                        return { output: 'Must provide toolIds to pin.' };
                    }

                    for (const id of params.toolIds) {
                        if (!catalog.lookupDefinition(id)) {
                            return { output: `Error: Tool ID "${id}" does not exist.` };
                        }
                        session.pinTool(id);
                    }

                    return { output: `📌 Pinned ${params.toolIds.length} tools. They will persist across turns.` };
                }

                case 'unpin': {
                    if (!params.toolIds?.length) {
                        return { output: 'Must provide toolIds to unpin.' };
                    }

                    for (const id of params.toolIds) {
                        session.unpinTool(id);
                    }

                    return { output: `✅ Unpinned: ${params.toolIds.join(', ')}` };
                }

                case 'list_active': {
                    const pinned = Array.from(session.pinnedTools);
                    const rag = Array.from(session.ragSelectedTools);

                    const formatList = (ids: string[]): string =>
                        ids.length === 0 ? '  (none)' : ids.map(id => {
                            const def = catalog.lookupDefinition(id);
                            return `  - ${id}${def ? ` — ${def.description.split('\n')[0]}` : ''}`;
                        }).join('\n');

                    return {
                        output: [
                            `📌 Pinned Tools (${pinned.length}):`,
                            formatList(pinned),
                            '',
                            `🔍 RAG-Selected Tools (${rag.length}, refreshed per-turn):`,
                            formatList(rag),
                        ].join('\n'),
                    };
                }

                default:
                    return { output: `Unknown action: ${params.action}` };
            }
        },
    });
}

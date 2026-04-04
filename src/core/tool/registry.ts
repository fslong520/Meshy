/**
 * ToolRegistry — 工具注册表与统一调度器
 *
 * 双层架构：
 * - Built-in 工具（常驻）：每次都注入 LLM context
 * - Lazy 工具（按需）：通过 ToolCatalog 索引，useTool 激活后才注入
 */

import { ToolDefinition, ToolContext, ToolResult } from './define.js';
import { StandardTool } from '../llm/provider.js';
import { ToolCatalog } from './catalog.js';
import { zodToJsonSchema } from './schema-util.js';
import { type ToolManifest } from './manifest.js';

export interface ToolManifestEntry {
    id: string;
    source: 'builtin' | 'catalog';
    manifest: ToolManifest;
}

export class ToolRegistry {
    private builtinTools: Map<string, ToolDefinition> = new Map();
    private catalog: ToolCatalog;

    constructor(catalog?: ToolCatalog) {
        this.catalog = catalog ?? new ToolCatalog();
    }

    // ═══════════════════════════════════════════
    // Built-in 工具（常驻）
    // ═══════════════════════════════════════════

    public register(tool: ToolDefinition): void {
        this.builtinTools.set(tool.id, tool);
    }

    public registerAll(tools: ToolDefinition[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    // ═══════════════════════════════════════════
    // Lazy 工具（按需加载，通过 Catalog 管理）
    // ═══════════════════════════════════════════

    public getCatalog(): ToolCatalog {
        return this.catalog;
    }

    // ═══════════════════════════════════════════
    // 输出 & 调度
    // ═══════════════════════════════════════════

    /**
     * 输出当前应注入 LLM context 的工具列表：
     * builtin 常驻 + 传入的 activeToolIds 所指定的 lazy 工具。
     */
    public toStandardTools(activeToolIds?: Set<string>): StandardTool[] {
        const builtin = Array.from(this.builtinTools.values()).map(tool => ({
            name: tool.id,
            description: tool.description,
            inputSchema: zodToJsonSchema(tool.parameters),
        }));

        const activated: StandardTool[] = [];
        if (activeToolIds) {
            for (const id of activeToolIds) {
                const tool = this.catalog.lookupDefinition(id);
                if (tool) {
                    activated.push({
                        name: tool.id,
                        description: tool.description,
                        inputSchema: zodToJsonSchema(tool.parameters),
                    });
                }
            }
        }

        return [...builtin, ...activated];
    }

    /**
     * 统一调度：先查 builtin，再查 catalog 已激活工具。
     * 由于 context.session 是激活状态的来源，这里利用 ctx.session.activatedTools 判断。
     */
    public async execute(
        name: string,
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        // 优先查找 builtin
        const builtin = this.builtinTools.get(name);
        if (builtin) return this.executeWithManifestPolicy(builtin, args, ctx);

        // 再查找 catalog 中已激活的工具
        const catalogTool = this.catalog.lookupDefinition(name);
        const isActive = ctx.session?.activatedTools.has(name) || false;

        if (catalogTool && isActive) {
            // 刷新 LRU 活跃度
            ctx.session?.touchTool(name);
            return this.executeWithManifestPolicy(catalogTool, args, ctx);
        }

        // 如果在 catalog 中但未激活，提示用户先 manageTools
        if (catalogTool && !isActive) {
            return {
                output: `Tool "${name}" exists but is not activated. Call manageTools with action="activate" first.`,
                isError: true,
            };
        }

        return { output: `Error: Unknown tool "${name}".`, isError: true };
    }

    private async executeWithManifestPolicy(
        tool: ToolDefinition,
        args: Record<string, unknown>,
        ctx: ToolContext,
    ): Promise<ToolResult> {
        const timeoutMs = tool.manifest.timeoutMs;

        if (timeoutMs === null || timeoutMs <= 0) {
            return tool.execute(args, ctx);
        }

        return new Promise<ToolResult>((resolve) => {
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve({
                    output: `Tool "${tool.id}" timed out after ${timeoutMs}ms.`,
                    isError: true,
                    metadata: {
                        timeoutMs,
                        policy: 'manifest-timeout',
                    },
                });
            }, timeoutMs);

            tool.execute(args, ctx)
                .then((result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch((error: unknown) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    const message = error instanceof Error ? error.message : String(error);
                    resolve({
                        output: `Tool "${tool.id}" execution failed: ${message}`,
                        isError: true,
                    });
                });
        });
    }

    public has(name: string): boolean {
        return this.builtinTools.has(name) || this.catalog.lookupDefinition(name) !== undefined;
    }

    public getManifest(name: string): ToolManifest | null {
        const builtin = this.builtinTools.get(name);
        if (builtin) {
            return { ...builtin.manifest };
        }

        const catalogTool = this.catalog.lookupDefinition(name);
        if (catalogTool) {
            return { ...catalogTool.manifest };
        }

        return null;
    }

    public listManifestEntries(): ToolManifestEntry[] {
        const builtinEntries: ToolManifestEntry[] = Array.from(this.builtinTools.values()).map((tool) => ({
            id: tool.id,
            source: 'builtin',
            manifest: { ...tool.manifest },
        }));

        const catalogEntries: ToolManifestEntry[] = this.catalog
            .getAllEntries()
            .map((entry) => this.catalog.lookupDefinition(entry.id))
            .filter((tool): tool is ToolDefinition => Boolean(tool))
            .map((tool) => ({
                id: tool.id,
                source: 'catalog',
                manifest: { ...tool.manifest },
            }));

        return [...builtinEntries, ...catalogEntries];
    }

    public ids(): string[] {
        const builtinIds = Array.from(this.builtinTools.keys());
        const catalogIds = this.catalog.getAllEntries().map(e => e.id);
        return [...builtinIds, ...catalogIds];
    }
}

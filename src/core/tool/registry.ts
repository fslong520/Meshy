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
import { type ToolManifest, type ToolPermissionClass } from './manifest.js';

export interface ToolManifestEntry {
    id: string;
    source: 'builtin' | 'catalog';
    manifest: ToolManifest;
}

export interface ToolManifestSummary {
    total: number;
    bySource: {
        builtin: number;
        catalog: number;
    };
    byPermissionClass: Partial<Record<ToolPermissionClass, number>>;
    timeoutConfigured: number;
    retryable: number;
}

export type ToolPolicyMode = 'standard' | 'read_only';

interface ToolPolicyDecision {
    decision: 'allow' | 'deny';
    mode: ToolPolicyMode;
    permissionClass: ToolPermissionClass;
    reason: string;
    timestamp: string;
}

export class ToolRegistry {
    private builtinTools: Map<string, ToolDefinition> = new Map();
    private catalog: ToolCatalog;
    private policyMode: ToolPolicyMode = 'standard';

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

    public setPolicyMode(mode: ToolPolicyMode): void {
        this.policyMode = mode;
    }

    public getPolicyMode(): ToolPolicyMode {
        return this.policyMode;
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
        const policyBlock = this.evaluatePolicy(tool);
        if (policyBlock) {
            return policyBlock;
        }

        const allowDecision: ToolPolicyDecision = {
            decision: 'allow',
            mode: this.policyMode,
            permissionClass: tool.manifest.permissionClass,
            reason: this.policyMode === 'read_only'
                ? 'permissionClass read is allowed in read-only mode'
                : 'policy mode allows tool execution',
            timestamp: new Date().toISOString(),
        };

        const timeoutMs = tool.manifest.timeoutMs;

        if (timeoutMs === null || timeoutMs <= 0) {
            try {
                const result = await tool.execute(args, ctx);
                return this.withPolicyDecision(result, allowDecision);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                return this.withPolicyDecision({
                    output: `Tool "${tool.id}" execution failed: ${message}`,
                    isError: true,
                }, allowDecision);
            }
        }

        return new Promise<ToolResult>((resolve) => {
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(this.withPolicyDecision({
                    output: `Tool "${tool.id}" timed out after ${timeoutMs}ms.`,
                    isError: true,
                    metadata: {
                        timeoutMs,
                        policy: 'manifest-timeout',
                    },
                } satisfies ToolResult, allowDecision));
            }, timeoutMs);

            tool.execute(args, ctx)
                .then((result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(this.withPolicyDecision(result, allowDecision));
                })
                .catch((error: unknown) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    const message = error instanceof Error ? error.message : String(error);
                    resolve(this.withPolicyDecision({
                        output: `Tool "${tool.id}" execution failed: ${message}`,
                        isError: true,
                    }, allowDecision));
                });
        });
    }

    private withPolicyDecision(result: ToolResult, policyDecision: ToolPolicyDecision): ToolResult {
        return {
            ...result,
            metadata: {
                ...(result.metadata ?? {}),
                policyDecision,
            },
        };
    }

    private evaluatePolicy(tool: ToolDefinition): ToolResult | null {
        if (this.policyMode !== 'read_only') {
            return null;
        }

        if (tool.manifest.permissionClass === 'read') {
            return null;
        }

        return {
            output: `Tool "${tool.id}" is blocked by read-only policy because it requires "${tool.manifest.permissionClass}" access.`,
            isError: true,
            metadata: {
                policyMode: this.policyMode,
                permissionClass: tool.manifest.permissionClass,
                policy: 'manifest-read-only',
                policyDecision: {
                    decision: 'deny',
                    mode: this.policyMode,
                    permissionClass: tool.manifest.permissionClass,
                    reason: `permissionClass ${tool.manifest.permissionClass} is blocked in read-only mode`,
                    timestamp: new Date().toISOString(),
                } satisfies ToolPolicyDecision,
            },
        };
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

    public summarizeManifestEntries(): ToolManifestSummary {
        const entries = this.listManifestEntries();
        const byPermissionClass: Partial<Record<ToolPermissionClass, number>> = {};
        let timeoutConfigured = 0;
        let retryable = 0;

        for (const entry of entries) {
            byPermissionClass[entry.manifest.permissionClass] = (byPermissionClass[entry.manifest.permissionClass] ?? 0) + 1;
            if (entry.manifest.timeoutMs !== null && entry.manifest.timeoutMs > 0) {
                timeoutConfigured += 1;
            }
            if (entry.manifest.retryable) {
                retryable += 1;
            }
        }

        return {
            total: entries.length,
            bySource: {
                builtin: entries.filter((entry) => entry.source === 'builtin').length,
                catalog: entries.filter((entry) => entry.source === 'catalog').length,
            },
            byPermissionClass,
            timeoutConfigured,
            retryable,
        };
    }

    public ids(): string[] {
        const builtinIds = Array.from(this.builtinTools.keys());
        const catalogIds = this.catalog.getAllEntries().map(e => e.id);
        return [...builtinIds, ...catalogIds];
    }
}

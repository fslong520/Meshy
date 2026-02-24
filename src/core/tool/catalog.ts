/**
 * ToolCatalog — 按需加载工具目录索引
 *
 * 核心机制：
 * 1. 维护一份轻量级索引 `{id, category, brief}`，仅几十个 token
 * 2. 生成广告文本注入 System Prompt，告知 LLM 有哪些额外工具可用
 * 3. LLM 通过 `useTool` 工具按名激活，运行时将完整 Schema 注入会话
 *
 * 这样无论挂载了多少 MCP/LSP 工具，每次只多花目录广告的 token，
 * 而非几千 token 的完整 Schema。
 */

import { ToolDefinition } from './define.js';

// ─── 索引条目 ───
export interface CatalogEntry {
    id: string;
    category: string;
    brief: string;
}

export class ToolCatalog {
    /** 完整工具定义（用于激活时查找） */
    private definitions: Map<string, ToolDefinition> = new Map();
    /** 轻量索引 */
    private entries: CatalogEntry[] = [];
    /** 当前激活的工具 ID */
    private activated: Set<string> = new Set();

    /**
     * 注册一个按需加载工具到目录。
     */
    public register(tool: ToolDefinition, category: string, brief: string): void {
        this.definitions.set(tool.id, tool);
        this.entries.push({ id: tool.id, category, brief });
    }

    /**
     * 批量注册同一分类下的工具。
     */
    public registerCategory(
        tools: Array<{ tool: ToolDefinition; brief: string }>,
        category: string,
    ): void {
        for (const { tool, brief } of tools) {
            this.register(tool, category, brief);
        }
    }

    /**
     * 生成工具目录广告文本，注入 System Prompt。
     *
     * 输出格式（每行仅约 50 chars，总计几十个 token）：
     * ```
     * --- Available Tools (use `useTool` to activate) ---
     * [lsp] lsp_goto_definition — Jump to symbol definition
     * [lsp] lsp_find_references — Find all references
     * [mcp:chrome] chrome_screenshot — Take page screenshot
     * ---
     * ```
     */
    public getAdvertText(): string {
        if (this.entries.length === 0) return '';

        const lines = this.entries.map(e =>
            `  [${e.category}] ${e.id} — ${e.brief}`,
        );

        return [
            '--- Available Extra Tools (call `useTool` with toolName to activate) ---',
            ...lines,
            '--- End of Tool Catalog ---',
        ].join('\n');
    }

    /**
     * 按分类获取工具列表。
     */
    public getByCategory(category: string): CatalogEntry[] {
        return this.entries.filter(e => e.category === category);
    }

    /**
     * 查找工具定义（用于激活）。
     */
    public lookupDefinition(toolId: string): ToolDefinition | undefined {
        return this.definitions.get(toolId);
    }

    /**
     * 激活一个工具（标记为已加载）。
     */
    public activate(toolId: string): ToolDefinition | undefined {
        const tool = this.definitions.get(toolId);
        if (tool) {
            this.activated.add(toolId);
        }
        return tool;
    }

    /**
     * 检查工具是否已激活。
     */
    public isActivated(toolId: string): boolean {
        return this.activated.has(toolId);
    }

    /**
     * 获取所有已激活的工具定义列表。
     */
    public getActivatedTools(): ToolDefinition[] {
        return Array.from(this.activated)
            .map(id => this.definitions.get(id))
            .filter((t): t is ToolDefinition => t !== undefined);
    }

    /**
     * 获取所有目录条目。
     */
    public getAllEntries(): CatalogEntry[] {
        return [...this.entries];
    }

    /**
     * 重置会话激活状态（新会话开始时调用）。
     */
    public resetActivations(): void {
        this.activated.clear();
    }
}

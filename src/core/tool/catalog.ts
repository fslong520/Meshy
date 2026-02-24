/**
 * ToolCatalog — 按需加载工具目录索引
 *
 * 核心机制：
 * 1. 维护一份轻量级索引 `{id, category, brief}`
 * 2. 同步构建 ToolRAGIndex（BM25 全文检索）
 * 3. 生成广告文本注入 System Prompt
 * 4. LLM 通过 `manageTools` 工具按名/类批量激活
 */

import { ToolDefinition } from './define.js';
import { ToolRAGIndex, ToolDocument } from './tool-rag.js';
import { zodToJsonSchema } from './schema-util.js';

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
    /** BM25 检索索引 */
    private ragIndex: ToolRAGIndex;

    constructor(ragIndex?: ToolRAGIndex) {
        this.ragIndex = ragIndex ?? new ToolRAGIndex();
    }

    /**
     * 注册一个按需加载工具到目录，同时推入 ToolRAG 索引。
     */
    public register(tool: ToolDefinition, category: string, brief: string): void {
        this.definitions.set(tool.id, tool);
        this.entries.push({ id: tool.id, category, brief });

        // 构建 ToolDocument 推入 BM25 索引
        const paramHints = this.extractParamHints(tool);
        const doc: ToolDocument = {
            id: tool.id,
            category,
            description: `${brief}. ${tool.description}`,
            parameterHints: paramHints,
        };
        this.ragIndex.addDocument(doc);
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
     * 获取关联的 ToolRAGIndex（供 manageTools 和 LazyInjector 使用）。
     */
    public getRagIndex(): ToolRAGIndex {
        return this.ragIndex;
    }

    /**
     * 生成工具目录广告文本，注入 System Prompt。
     * 仅在 Catalog 规模较小时有用；大规模时由 ToolRAG 处理。
     */
    public getAdvertText(): string {
        if (this.entries.length === 0) return '';

        // 超过 20 个工具时只显示分类摘要，避免广告文本自身消耗过多 token
        if (this.entries.length > 20) {
            const categories = new Map<string, number>();
            for (const e of this.entries) {
                categories.set(e.category, (categories.get(e.category) || 0) + 1);
            }
            const catLines = Array.from(categories.entries())
                .map(([cat, count]) => `  [${cat}] ${count} tools`);

            return [
                '--- Tool Catalog (use `manageTools` with action="search" to find specific tools) ---',
                ...catLines,
                `Total: ${this.entries.length} extra tools available`,
                '--- End ---',
            ].join('\n');
        }

        const lines = this.entries.map(e =>
            `  [${e.category}] ${e.id} — ${e.brief}`,
        );

        return [
            '--- Available Extra Tools (use `manageTools` to activate) ---',
            ...lines,
            '--- End of Tool Catalog ---',
        ].join('\n');
    }

    public getByCategory(category: string): CatalogEntry[] {
        return this.entries.filter(e => e.category === category);
    }

    public lookupDefinition(toolId: string): ToolDefinition | undefined {
        return this.definitions.get(toolId);
    }

    public getAllEntries(): CatalogEntry[] {
        return [...this.entries];
    }

    /**
     * 从 Zod schema 提取参数名和描述的文本摘要。
     */
    private extractParamHints(tool: ToolDefinition): string {
        try {
            const schema = zodToJsonSchema(tool.parameters);
            const props = (schema as any)?.properties;
            if (!props) return '';
            return Object.entries(props)
                .map(([key, val]: [string, any]) => `${key}: ${val.description || val.type || ''}`)
                .join(', ');
        } catch {
            return '';
        }
    }
}


/**
 * ToolPack — 预设工具包（确定性快速路径）
 *
 * 对于 LSP、Session 管理等小而确定的工具集，
 * 直接匹配关键词并全量加载，无需走 ToolRAG 语义检索。
 */

export interface ToolPack {
    /** 包名，如 "lsp", "session", "blender_mesh" */
    name: string;
    /** 触发关键词（匹配用户输入即命中整个包） */
    triggerKeywords: string[];
    /** 包含的工具 ID 列表 */
    toolIds: string[];
}

export class ToolPackRegistry {
    private packs: Map<string, ToolPack> = new Map();

    public register(pack: ToolPack): void {
        this.packs.set(pack.name, pack);
    }

    /**
     * 根据用户输入和可选的路由推荐，返回所有命中的包。
     */
    public match(
        userInput: string,
        suggestedPacks?: string[],
    ): ToolPack[] {
        const hits: ToolPack[] = [];
        const normalizedInput = userInput.toLowerCase();

        for (const pack of this.packs.values()) {
            // 1. 路由决策显式推荐
            if (suggestedPacks?.includes(pack.name)) {
                hits.push(pack);
                continue;
            }

            // 2. 关键词匹配
            const matched = pack.triggerKeywords.some(
                kw => normalizedInput.includes(kw.toLowerCase()),
            );
            if (matched) {
                hits.push(pack);
            }
        }

        return hits;
    }

    /**
     * 提取命中包中的所有去重工具 ID。
     */
    public collectToolIds(packs: ToolPack[]): string[] {
        const ids = new Set<string>();
        for (const pack of packs) {
            for (const id of pack.toolIds) {
                ids.add(id);
            }
        }
        return Array.from(ids);
    }

    public getPack(name: string): ToolPack | undefined {
        return this.packs.get(name);
    }

    public listPacks(): ToolPack[] {
        return Array.from(this.packs.values());
    }
}

// ─── 内置预设包 ───

export const LSP_PACK: ToolPack = {
    name: 'lsp',
    triggerKeywords: [
        '重构', 'refactor', 'goto definition', 'find references',
        'rename', 'symbols', 'diagnostics', '引用', '定义跳转',
        'lsp', '类型定义',
    ],
    toolIds: [
        'lsp_goto_definition',
        'lsp_find_references',
        'lsp_symbols',
        'lsp_diagnostics',
        'lsp_prepare_rename',
        'lsp_rename',
    ],
};

export const SESSION_PACK: ToolPack = {
    name: 'session',
    triggerKeywords: [
        'session', '会话', '历史', 'history', '上次对话', '之前的',
    ],
    toolIds: [
        'session_list',
        'session_read',
        'session_search',
        'session_info',
    ],
};

/**
 * 工厂：创建包含默认内置预设包的 ToolPackRegistry。
 */
export function createDefaultToolPackRegistry(): ToolPackRegistry {
    const registry = new ToolPackRegistry();
    registry.register(LSP_PACK);
    registry.register(SESSION_PACK);
    return registry;
}

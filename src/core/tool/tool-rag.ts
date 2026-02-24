/**
 * ToolRAG — BM25 全文检索工具索引
 *
 * 面向大型 MCP（如 Blender 50+ tools）的语义工具检索。
 * MVP 实现：纯 TypeScript BM25 算法，零外部依赖。
 *
 * 参考：ScaleMCP (arXiv 2025) 的 Tool Document 概念，
 * 但使用 BM25 替代向量检索以降低首版复杂度。
 */

// ─── Tool Document ───

export interface ToolDocument {
    /** 工具唯一标识 */
    id: string;
    /** 分类 */
    category: string;
    /** 工具描述 */
    description: string;
    /** 参数摘要文本 */
    parameterHints: string;
}

// ─── BM25 实现 ───

interface BM25Doc {
    id: string;
    terms: string[];
    termFreq: Map<string, number>;
    length: number;
}

/** BM25 参数 */
const K1 = 1.2;
const B = 0.75;

/**
 * 纯 TS 实现的 BM25 全文检索索引。
 *
 * - 索引构建时对每个 ToolDocument 做分词并计算 TF
 * - 查询时计算 BM25 score 并返回 Top-K
 */
export class ToolRAGIndex {
    private docs: BM25Doc[] = [];
    private docFreq: Map<string, number> = new Map();
    private avgDocLength = 0;

    /**
     * 添加一个工具文档到索引。
     */
    public addDocument(doc: ToolDocument): void {
        const text = [
            doc.id,
            doc.category,
            doc.description,
            doc.parameterHints,
        ].join(' ');

        const terms = this.tokenize(text);
        const termFreq = new Map<string, number>();

        for (const term of terms) {
            termFreq.set(term, (termFreq.get(term) || 0) + 1);
        }

        this.docs.push({
            id: doc.id,
            terms,
            termFreq,
            length: terms.length,
        });

        // 更新文档频率
        for (const term of new Set(terms)) {
            this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
        }

        // 更新平均文档长度
        this.avgDocLength = this.docs.reduce((sum, d) => sum + d.length, 0) / this.docs.length;
    }

    /**
     * 批量添加文档。
     */
    public addDocuments(docs: ToolDocument[]): void {
        for (const doc of docs) {
            this.addDocument(doc);
        }
    }

    /**
     * BM25 检索，返回按相关性排序的工具 ID 列表。
     */
    public search(query: string, topK: number = 8): string[] {
        if (this.docs.length === 0) return [];

        const queryTerms = this.tokenize(query);
        if (queryTerms.length === 0) return [];

        const n = this.docs.length;
        const scores: Array<{ id: string; score: number }> = [];

        for (const doc of this.docs) {
            let score = 0;

            for (const qt of queryTerms) {
                const df = this.docFreq.get(qt) || 0;
                if (df === 0) continue;

                // IDF
                const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);

                // TF
                const tf = doc.termFreq.get(qt) || 0;

                // BM25 score
                const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.length / this.avgDocLength));
                score += idf * tfNorm;
            }

            if (score > 0) {
                scores.push({ id: doc.id, score });
            }
        }

        // 按 score 降序排序，取 Top-K
        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, topK).map(s => s.id);
    }

    /**
     * 获取索引文档数量。
     */
    public get size(): number {
        return this.docs.length;
    }

    // ─── 内部分词器 ───

    /**
     * 简易分词：小写化 + 按非字母数字拆分 + 去停用词。
     * 对中文支持有限（按单字拆分），足够 MVP 使用。
     */
    private tokenize(text: string): string[] {
        const lower = text.toLowerCase();
        // 拆分英文单词 + 中文单字
        const raw = lower.match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || [];
        return raw.filter(t => t.length > 1 || /[\u4e00-\u9fff]/.test(t));
    }
}

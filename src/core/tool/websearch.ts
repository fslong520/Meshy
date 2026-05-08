/**
 * WebSearch Tool — 搜索引擎查询工具
 *
 * 执行搜索引擎查询，返回结构化的搜索结果列表。
 * MVP 实现：使用 fetch 调用公共搜索 API。
 * 可通过配置切换 provider (Tavily / Brave / Serper 等)。
 */

import { z } from 'zod';
import { defineTool } from './define.js';

const DEFAULT_MAX_RESULTS = 5;

/**
 * 搜索结果条目
 */
interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

/**
 * MVP 搜索实现：使用 DuckDuckGo Instant Answers API（无需 API Key）。
 * 生产环境建议替换为 Tavily / Brave Search / Serper 等付费 API。
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url, {
        headers: { 'User-Agent': 'Meshy/1.0 (AI Assistant)' },
    });

    if (!response.ok) {
        throw new Error(`Search API returned ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const results: SearchResult[] = [];

    // Abstract (主要答案)
    if (data.AbstractText && data.AbstractURL) {
        results.push({
            title: String(data.Heading || 'Result'),
            url: String(data.AbstractURL),
            snippet: String(data.AbstractText),
        });
    }

    // RelatedTopics
    const related = data.RelatedTopics;
    if (Array.isArray(related)) {
        for (const topic of related) {
            if (results.length >= maxResults) break;
            if (topic && typeof topic === 'object' && 'FirstURL' in topic && 'Text' in topic) {
                results.push({
                    title: String(topic.Text).slice(0, 100),
                    url: String(topic.FirstURL),
                    snippet: String(topic.Text),
                });
            }
        }
    }

    // Results (直接搜索结果)
    const directResults = data.Results;
    if (Array.isArray(directResults)) {
        for (const r of directResults) {
            if (results.length >= maxResults) break;
            if (r && typeof r === 'object' && 'FirstURL' in r) {
                results.push({
                    title: String(r.Text || '').slice(0, 100),
                    url: String(r.FirstURL),
                    snippet: String(r.Text || ''),
                });
            }
        }
    }

    return results;
}

export const WebSearchTool = defineTool('websearch', {
    description: [
        'Search the web for information.',
        'Returns a list of search results with titles, URLs, and snippets.',
        'Use this to find current information, documentation, or answers to questions.',
        'For fetching a specific URL, use the webfetch tool instead.',
    ].join('\n'),
    parameters: z.object({
        query: z.string().describe('The search query'),
        maxResults: z.coerce.number()
                .int()
                .positive()
                .max(50)
                .describe('Maximum number of results to return (default 5)')
                .optional(),
    }),
    manifest: {
        permissionClass: 'network',
    },
    async execute(params) {
        const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;

        try {
            const results = await searchDuckDuckGo(params.query, maxResults);

            if (results.length === 0) {
                return {
                    output: `No results found for "${params.query}". Try different keywords.`,
                    metadata: { count: 0 },
                };
            }

            const lines = results.map((r, i) =>
                `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`,
            );

            return {
                output: `Search results for "${params.query}":\n\n${lines.join('\n\n')}`,
                metadata: { count: results.length },
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { output: `Search failed: ${message}` };
        }
    },
});

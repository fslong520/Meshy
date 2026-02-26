/**
 * WebFetch Tool — URL 内容抓取工具
 *
 * 通过 HTTP GET 获取网页内容，将 HTML 简易转换为纯文本。
 * 用于读取文档、API 参考、博客文章等在线内容。
 */

import { z } from 'zod';
import { defineTool } from './define.js';
import { fetch, ProxyAgent, RequestInit } from 'undici';

const DEFAULT_MAX_LENGTH = 500_000; // Increased to 500KB for Phase 20
const DEFAULT_TIMEOUT_MS = 15_000;

function getProxyAgent(): ProxyAgent | undefined {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    if (proxyUrl) {
        return new ProxyAgent(proxyUrl);
    }
    return undefined;
}

/**
 * 简易 HTML → 纯文本转换。
 * 去除标签、解码常见实体、压缩空白。
 */
function htmlToText(html: string): string {
    return html
        // 移除 script/style 块
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        // 块级元素转换行
        .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        // 移除所有标签
        .replace(/<[^>]+>/g, '')
        // 解码常见 HTML 实体
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // 压缩空白行
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

export const WebFetchTool = defineTool('webfetch', {
    description: [
        'Fetch the content of a URL and return it as text.',
        'Useful for reading documentation, API references, blog posts, or any web page.',
        'HTML content is automatically converted to plain text.',
        'For search engine queries, use the websearch tool instead.',
    ].join('\n'),
    parameters: z.object({
        url: z.string().describe('The URL to fetch'),
        maxLength: z.number()
            .describe('Maximum number of characters to return (default 20000)')
            .optional(),
    }),
    async execute(params) {
        const maxLength = params.maxLength ?? DEFAULT_MAX_LENGTH;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

            const dispatcher = getProxyAgent();
            const fetchOptions: RequestInit = {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Meshy/1.0 (AI Assistant)',
                    'Accept': 'text/html, text/plain, application/json, */*',
                },
                dispatcher
            };

            // 1. HEAD pre-check
            try {
                const headResponse = await fetch(params.url, { ...fetchOptions, method: 'HEAD' });
                if (headResponse.ok) {
                    const contentLength = headResponse.headers.get('content-length');
                    if (contentLength && parseInt(contentLength, 10) > maxLength * 2) {
                        clearTimeout(timer);
                        return {
                            output: `Error: The file is extremely large (${contentLength} bytes) and exceeds the safety limit of ${maxLength * 2} bytes.`,
                            metadata: { status: headResponse.status, contentLength }
                        };
                    }
                }
            } catch (e) {
                // Some servers reject HEAD requests. Ignore and proceed to GET.
            }

            // 2. Full GET request
            const response = await fetch(params.url, fetchOptions);

            clearTimeout(timer);

            if (!response.ok) {
                return {
                    output: `HTTP ${response.status} ${response.statusText} for ${params.url}`,
                    metadata: { status: response.status },
                };
            }

            const contentType = response.headers.get('content-type') || '';
            const rawBody = await response.text();

            // JSON 直接返回
            if (contentType.includes('application/json')) {
                const truncated = rawBody.length > maxLength
                    ? rawBody.slice(0, maxLength) + '\n\n... (truncated)'
                    : rawBody;
                return { output: truncated, metadata: { contentType, length: rawBody.length } };
            }

            // HTML 转文本
            const text = contentType.includes('text/html') ? htmlToText(rawBody) : rawBody;
            const truncated = text.length > maxLength
                ? text.slice(0, maxLength) + '\n\n... (truncated)'
                : text;

            return {
                output: truncated,
                metadata: { contentType, length: text.length, truncated: text.length > maxLength },
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { output: `Failed to fetch ${params.url}: ${message}` };
        }
    },
});

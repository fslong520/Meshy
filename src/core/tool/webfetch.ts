import { z } from 'zod';
import { defineTool } from './define.js';
import { fetch, ProxyAgent, RequestInit } from 'undici';
import TurndownService from 'turndown';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB limit matching opencode
const DEFAULT_TIMEOUT_MS = 30_000;

function getProxyAgent(): ProxyAgent | undefined {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    if (proxyUrl) {
        return new ProxyAgent(proxyUrl);
    }
    return undefined;
}

/**
 * HTML → Markdown 转换 (使用 Turndown)
 */
function convertToMarkdown(html: string): string {
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
    });
    return turndownService.turndown(html);
}

/**
 * HTML → 纯文本转换 (简易实现)
 */
function convertToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

export const WebFetchTool = defineTool('webfetch', {
    description: [
        'Fetch the content of a URL and return it in the requested format.',
        'Useful for reading documentation, API references, or any web page.',
        'Supports standard formats: markdown (default), text, and html.',
    ].join('\n'),
    parameters: z.object({
        url: z.string().describe('The URL to fetch content from'),
        format: z.enum(['text', 'markdown', 'html']).default('markdown').describe('The format to return the content in'),
    }),
    manifest: {
        permissionClass: 'network',
    },
    async execute(params) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

            const dispatcher = getProxyAgent();
            const fetchOptions: RequestInit = {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,text/markdown,*/*;q=0.8',
                },
                dispatcher
            };

            const response = await fetch(params.url, fetchOptions);
            clearTimeout(timer);

            if (!response.ok) {
                return {
                    output: `Error: HTTP ${response.status} ${response.statusText} for ${params.url}`,
                    metadata: { status: response.status }
                };
            }

            const arrayBuffer = await response.arrayBuffer();
            if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
                return {
                    output: `Error: Response too large (${arrayBuffer.byteLength} bytes). Exceeds 5MB limit.`,
                    metadata: { size: arrayBuffer.byteLength }
                };
            }

            const contentType = response.headers.get('content-type') || '';
            const html = new TextDecoder().decode(arrayBuffer);
            let finalOutput = html;

            if (contentType.includes('text/html')) {
                if (params.format === 'markdown') {
                    finalOutput = convertToMarkdown(html);
                } else if (params.format === 'text') {
                    finalOutput = convertToText(html);
                }
            }

            return {
                output: finalOutput,
                metadata: {
                    contentType,
                    format: params.format,
                    length: finalOutput.length
                },
            };
        } catch (err: any) {
            const message = err.name === 'AbortError' ? 'Timeout: Request took longer than 30s' : err.message;
            return {
                output: `Error fetching URL: ${message}`,
                metadata: { error: message },
            };
        }
    },
});

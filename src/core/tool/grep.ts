/**
 * Grep Tool — 按正则搜索文件内容
 *
 * 递归搜索工作区文件内容，返回匹配行。
 * 结果按文件修改时间倒排。
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { defineTool } from './define.js';

const LIMIT = 100;
const MAX_LINE_LENGTH = 2000;
const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'target',
    'vendor', '.idea', '.vscode', '__pycache__', '.cache',
]);
const BINARY_EXTENSIONS = new Set([
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.class',
    '.jar', '.png', '.jpg', '.gif', '.bmp', '.ico', '.pdf',
    '.wasm', '.pyc', '.o', '.a', '.lib', '.bin', '.dat',
]);

interface GrepMatch {
    filePath: string;
    lineNum: number;
    lineText: string;
    mtime: number;
}

function searchFile(
    filePath: string,
    regex: RegExp,
    mtime: number,
    matches: GrepMatch[],
): void {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        return;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (matches.length >= LIMIT) return;
        if (regex.test(lines[i])) {
            const text = lines[i].length > MAX_LINE_LENGTH
                ? lines[i].substring(0, MAX_LINE_LENGTH) + '...'
                : lines[i];
            matches.push({ filePath, lineNum: i + 1, lineText: text, mtime });
        }
    }
}

function walkAndGrep(
    dir: string,
    regex: RegExp,
    includePattern: RegExp | null,
    matches: GrepMatch[],
): void {
    if (matches.length >= LIMIT) return;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (matches.length >= LIMIT) return;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue;
            walkAndGrep(fullPath, regex, includePattern, matches);
            continue;
        }

        if (!entry.isFile()) continue;

        // 跳过二进制文件
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;

        // include 过滤
        if (includePattern && !includePattern.test(entry.name)) continue;

        try {
            const stat = fs.statSync(fullPath);
            searchFile(fullPath, regex, stat.mtimeMs, matches);
        } catch {
            // skip
        }
    }
}

export const GrepTool = defineTool('grep', {
    description: [
        'Search file contents using a regex pattern.',
        'Returns matching lines with file paths and line numbers.',
        'Results are sorted by file modification time (most recent first).',
    ].join('\n'),
    parameters: z.object({
        pattern: z.string().describe('The regex pattern to search for in file contents'),
        path: z.string().optional().describe('The directory to search in. Defaults to workspace root.'),
        include: z.string().optional().describe('File pattern to include (e.g. "*.ts", "*.{ts,tsx}")'),
    }),
    async execute(params, ctx) {
        let searchDir = params.path ?? ctx.workspaceRoot;
        if (!path.isAbsolute(searchDir)) {
            searchDir = path.resolve(ctx.workspaceRoot, searchDir);
        }

        let regex: RegExp;
        try {
            regex = new RegExp(params.pattern, 'g');
        } catch {
            return { output: `Invalid regex pattern: "${params.pattern}"` };
        }

        // 将 include glob 转为简易 regex
        let includePattern: RegExp | null = null;
        if (params.include) {
            const globRegex = params.include
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.');
            includePattern = new RegExp(`^${globRegex}$`);
        }

        const matches: GrepMatch[] = [];
        walkAndGrep(searchDir, regex, includePattern, matches);

        if (matches.length === 0) {
            return { output: 'No matches found', metadata: { matches: 0, truncated: false } };
        }

        // 按修改时间倒排
        matches.sort((a, b) => b.mtime - a.mtime);

        const truncated = matches.length >= LIMIT;
        const lines: string[] = [`Found ${matches.length} matches${truncated ? ` (showing first ${LIMIT})` : ''}`];

        let currentFile = '';
        for (const match of matches) {
            if (currentFile !== match.filePath) {
                if (currentFile !== '') lines.push('');
                currentFile = match.filePath;
                lines.push(`${match.filePath}:`);
            }
            lines.push(`  Line ${match.lineNum}: ${match.lineText}`);
        }

        if (truncated) {
            lines.push('', `(Results truncated. Consider using a more specific path or pattern.)`);
        }

        return {
            output: lines.join('\n'),
            metadata: { matches: matches.length, truncated },
        };
    },
});

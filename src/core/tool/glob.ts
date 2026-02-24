/**
 * Glob Tool — 按模式搜索文件名
 *
 * 递归搜索工作区内匹配指定 glob 模式的文件路径。
 * 返回匹配的绝对路径列表，按修改时间倒排。
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { defineTool } from './define.js';

const LIMIT = 100;
const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'target',
    'vendor', '.idea', '.vscode', '__pycache__', '.cache',
    'coverage', '.venv', 'venv', 'tmp', 'temp',
]);

/**
 * 简易 glob 匹配 (支持 *, **, ?)
 */
function matchGlob(filename: string, pattern: string): boolean {
    const regex = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '§GLOBSTAR§')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/§GLOBSTAR§/g, '.*');
    return new RegExp(`^${regex}$`).test(filename);
}

function walkDir(
    dir: string,
    pattern: string,
    results: Array<{ filePath: string; mtime: number }>,
    rootDir: string,
): void {
    if (results.length >= LIMIT) return;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (results.length >= LIMIT) return;

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue;
            walkDir(path.join(dir, entry.name), pattern, results, rootDir);
            continue;
        }

        if (!entry.isFile()) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

        // 匹配文件名或完整相对路径
        if (matchGlob(entry.name, pattern) || matchGlob(relativePath, pattern)) {
            try {
                const stat = fs.statSync(fullPath);
                results.push({ filePath: fullPath, mtime: stat.mtimeMs });
            } catch {
                results.push({ filePath: fullPath, mtime: 0 });
            }
        }
    }
}

export const GlobTool = defineTool('glob', {
    description: [
        'Search for files by glob pattern.',
        'Returns matching file paths sorted by modification time (most recent first).',
        'Common patterns: "*.ts", "**/*.test.ts", "src/**/*.{ts,tsx}"',
    ].join('\n'),
    parameters: z.object({
        pattern: z.string().describe('The glob pattern to match files against'),
        path: z.string().optional().describe('The directory to search in. Defaults to workspace root.'),
    }),
    async execute(params, ctx) {
        let searchDir = params.path ?? ctx.workspaceRoot;
        if (!path.isAbsolute(searchDir)) {
            searchDir = path.resolve(ctx.workspaceRoot, searchDir);
        }

        const results: Array<{ filePath: string; mtime: number }> = [];
        walkDir(searchDir, params.pattern, results, searchDir);

        // 按修改时间倒排
        results.sort((a, b) => b.mtime - a.mtime);

        if (results.length === 0) {
            return { output: 'No files found', metadata: { count: 0, truncated: false } };
        }

        const truncated = results.length >= LIMIT;
        const lines = results.map(r => r.filePath);

        if (truncated) {
            lines.push('', `(Results truncated: showing first ${LIMIT} results. Use a more specific path or pattern.)`);
        }

        return {
            output: lines.join('\n'),
            metadata: { count: results.length, truncated },
        };
    },
});

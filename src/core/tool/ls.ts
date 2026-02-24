/**
 * Ls Tool — 目录树列出工具
 *
 * 递归列出目录结构，缩进树形展示。
 * 自动忽略 node_modules / .git / dist 等。
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { defineTool } from './define.js';

const LIMIT = 200;
const DEFAULT_IGNORE = new Set([
    'node_modules', '.git', 'dist', 'build', 'target',
    'vendor', '.idea', '.vscode', '__pycache__', '.cache',
    'coverage', '.venv', 'venv', 'tmp', 'temp', 'bin',
    'obj', '.zig-cache', 'zig-out', 'logs',
]);

interface DirEntry {
    name: string;
    isDir: boolean;
    children?: DirEntry[];
}

function scanDir(
    dir: string,
    ignoreSet: Set<string>,
    counter: { count: number },
): DirEntry[] {
    if (counter.count >= LIMIT) return [];

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    const result: DirEntry[] = [];

    // 先排序：目录在前，文件在后，各自按名称排
    const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
        if (counter.count >= LIMIT) break;

        if (entry.isDirectory()) {
            if (ignoreSet.has(entry.name)) continue;

            const children = scanDir(path.join(dir, entry.name), ignoreSet, counter);
            result.push({ name: entry.name, isDir: true, children });
        } else {
            counter.count++;
            result.push({ name: entry.name, isDir: false });
        }
    }

    return result;
}

function renderTree(entries: DirEntry[], depth: number): string {
    let output = '';
    for (const entry of entries) {
        const indent = '  '.repeat(depth);
        if (entry.isDir) {
            output += `${indent}${entry.name}/\n`;
            if (entry.children) {
                output += renderTree(entry.children, depth + 1);
            }
        } else {
            output += `${indent}${entry.name}\n`;
        }
    }
    return output;
}

export const LsTool = defineTool('ls', {
    description: [
        'List the contents of a directory as a tree structure.',
        'Automatically ignores common directories like node_modules, .git, dist, etc.',
        'Use this to understand project structure before reading or editing files.',
    ].join('\n'),
    parameters: z.object({
        path: z.string().optional().describe('The absolute path to the directory to list. Defaults to workspace root.'),
        ignore: z.array(z.string()).optional().describe('Additional directory names to ignore'),
    }),
    async execute(params, ctx) {
        let searchPath = params.path ?? ctx.workspaceRoot;
        if (!path.isAbsolute(searchPath)) {
            searchPath = path.resolve(ctx.workspaceRoot, searchPath);
        }

        if (!fs.existsSync(searchPath)) {
            return { output: `Directory not found: ${searchPath}` };
        }

        const ignoreSet = new Set(DEFAULT_IGNORE);
        if (params.ignore) {
            for (const p of params.ignore) {
                ignoreSet.add(p);
            }
        }

        const counter = { count: 0 };
        const tree = scanDir(searchPath, ignoreSet, counter);
        const truncated = counter.count >= LIMIT;

        let output = `${searchPath}/\n`;
        output += renderTree(tree, 1);

        if (truncated) {
            output += `\n(Showing first ${LIMIT} files. Use a more specific path for deeper exploration.)`;
        }

        return {
            output,
            metadata: { count: counter.count, truncated },
        };
    },
});

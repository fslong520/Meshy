import * as fs from 'fs';
import * as path from 'path';

export interface RepoMapOptions {
    ignorePatterns?: string[];
    maxTokens?: number;
}

/**
 * Lightweight RepoMap Generator
 * Uses RegExp to extract exported classes, functions, interfaces, and types from TS/JS files.
 * Provides a highly condensed overview of the codebase to the LLM without reading all files.
 */
export class RepoMapGenerator {
    private ignoreRules = ['.git', 'node_modules', 'dist', 'build', '.meshy', 'coverage', '.next'];
    private workspaceRoot: string;

    constructor(workspaceRoot: string, options?: RepoMapOptions) {
        this.workspaceRoot = workspaceRoot;
        if (options?.ignorePatterns) {
            this.ignoreRules.push(...options.ignorePatterns);
        }
    }

    /**
     * Generate the markdown string map of the repository
     */
    public generate(): string {
        try {
            const files = this.scanDirectory(this.workspaceRoot);
            let mapContent = '# Repository Map\n\n';

            for (const file of files) {
                const symbols = this.extractSymbols(file);
                if (symbols.length > 0) {
                    const relativePath = path.relative(this.workspaceRoot, file).replace(/\\/g, '/');
                    mapContent += `## ${relativePath}\n`;
                    for (const sym of symbols) {
                        mapContent += `- ${sym}\n`;
                    }
                    mapContent += '\n';
                }
            }

            return mapContent.trim();
        } catch (err) {
            console.error('[RepoMap] Failed to generate map:', err);
            return 'Failed to generate repository map.';
        }
    }

    private scanDirectory(dir: string, fileList: string[] = []): string[] {
        let items: string[] = [];
        try {
            items = fs.readdirSync(dir);
        } catch {
            return fileList;
        }

        for (const item of items) {
            if (this.ignoreRules.includes(item)) {
                continue;
            }

            const fullPath = path.join(dir, item);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(fullPath);
            } catch {
                continue;
            }

            if (stat.isDirectory()) {
                this.scanDirectory(fullPath, fileList);
            } else if (stat.isFile()) {
                if (fullPath.endsWith('.ts') || fullPath.endsWith('.js') || fullPath.endsWith('.tsx') || fullPath.endsWith('.jsx')) {
                    // Skip config files, test files, etc.
                    if (!item.includes('.test.') && !item.includes('.spec.') && !item.endsWith('.d.ts')) {
                        fileList.push(fullPath);
                    }
                }
            }
        }

        return fileList;
    }

    private extractSymbols(filePath: string): string[] {
        const symbols: string[] = [];
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();

                // Match exported classes (e.g., export class TaskEngine)
                let match = trimmed.match(/^export\s+(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)/);
                if (match) {
                    symbols.push(`class ${match[1]}`);
                    continue;
                }

                // Match exported functions (e.g., export function parseMentions)
                match = trimmed.match(/^export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)/);
                if (match) {
                    symbols.push(`function ${match[1]}`);
                    continue;
                }

                // Match exported const arrows (e.g., export const myFunc = () => ...)
                match = trimmed.match(/^export\s+const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>/);
                if (match) {
                    symbols.push(`function ${match[1]}`);
                    continue;
                }

                // Match exported interfaces / types
                match = trimmed.match(/^export\s+(interface|type)\s+([a-zA-Z0-9_]+)/);
                if (match) {
                    symbols.push(`${match[1]} ${match[2]}`);
                    continue;
                }
            }
        } catch {
            // Ignore read errors
        }

        return symbols;
    }
}

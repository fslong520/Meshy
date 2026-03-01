import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { TerminalManager } from './terminal.js';

export interface ReadFileResult {
    content: string;
    totalLines: number;
    truncated: boolean;
    hash: string;
}

export class AgentComputerInterface {
    private workspaceRoot: string;
    public terminalManager: TerminalManager;

    constructor(workspaceRoot: string = process.cwd()) {
        this.workspaceRoot = workspaceRoot;
        this.terminalManager = new TerminalManager(this.workspaceRoot);
    }

    private resolveSafePath(userPath: string): string {
        const resolved = path.resolve(this.workspaceRoot, userPath);
        if (!resolved.startsWith(this.workspaceRoot)) {
            throw new Error(`Path ${userPath} escapes workspace directory.`);
        }
        return resolved;
    }

    private getFileHash(filePath: string): string {
        const fileBuffer = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    }

    /**
     * Reads a file and returns its content with line numbers.
     * Auto-paginates/truncates if exceeding max lines to prevent token explosion.
     */
    public readFile(filePath: string, startLine: number = 1, maxLines: number = 500): ReadFileResult {
        let absolutePath: string;
        try {
            absolutePath = this.resolveSafePath(filePath);
        } catch (e) {
            throw new Error(`File lookup error: ${(e as Error).message}`);
        }

        if (!fs.existsSync(absolutePath)) {
            const dir = path.dirname(absolutePath);
            const base = path.basename(absolutePath);
            let suggestions: string[] = [];
            try {
                if (fs.existsSync(dir)) {
                    const entries = fs.readdirSync(dir);
                    suggestions = entries
                        .filter(e => e.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(e.toLowerCase()))
                        .map(e => path.join(path.dirname(filePath), e))
                        .slice(0, 3);
                }
            } catch (err) { }

            if (suggestions.length > 0) {
                throw new Error(`File not found: ${filePath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`);
            }
            throw new Error(`File not found: ${filePath}`);
        }

        const stat = fs.statSync(absolutePath);
        if (stat.isDirectory()) {
            throw new Error(`Cannot read directory as file: ${filePath}. Please use a tool like 'ls' or 'bash' to list its contents.`);
        }

        // Simple binary check: check first 4096 bytes for null characters
        const sampleSize = Math.min(4096, stat.size);
        if (sampleSize > 0) {
            const buffer = Buffer.alloc(sampleSize);
            const fd = fs.openSync(absolutePath, 'r');
            fs.readSync(fd, buffer, 0, sampleSize, 0);
            fs.closeSync(fd);
            if (buffer.includes(0)) {
                throw new Error(`Cannot read binary file: ${filePath}`);
            }
        }

        const content = fs.readFileSync(absolutePath, 'utf8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        const hash = this.getFileHash(absolutePath);

        // Apply pagination
        const endLine = Math.min(startLine + maxLines - 1, totalLines);
        const sliced = lines.slice(startLine - 1, endLine);

        const MAX_LINE_LENGTH = 2000;
        // Prefix with line numbers and truncate long lines
        const numberedContent = sliced.map((line, idx) => {
            let safeLine = line.length > MAX_LINE_LENGTH
                ? line.substring(0, MAX_LINE_LENGTH) + `... (line truncated to ${MAX_LINE_LENGTH} chars)`
                : line;
            return `${startLine + idx}: ${safeLine}`;
        }).join('\n');

        const truncated = endLine < totalLines;

        let formattedContent = numberedContent;
        if (truncated) {
            formattedContent += `\n\n(Showing lines ${startLine}-${endLine} of ${totalLines}. Use startLine=${endLine + 1} to continue.)`;
        } else {
            formattedContent += `\n\n(End of file - total ${totalLines} lines)`;
        }

        return {
            content: formattedContent,
            totalLines,
            truncated,
            hash
        };
    }

    /**
     * Replaces a specific block of text in a file.
     * Employs concurrency guard by checking file hash.
     */
    public editFile(filePath: string, expectedHash: string, searchBlock: string, replaceBlock: string): void {
        const absolutePath = this.resolveSafePath(filePath);

        if (!fs.existsSync(absolutePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const currentHash = this.getFileHash(absolutePath);
        if (currentHash !== expectedHash) {
            throw new Error(
                `Concurrency Guard Error: File ${filePath} has been modified since it was last read. Please read the file again to get the latest hash and content.`
            );
        }

        const content = fs.readFileSync(absolutePath, 'utf8');

        // Note: This is an exact string match replacement.
        // Future enhancements might include fuzzy matching if formatting slightly changed.
        if (!content.includes(searchBlock)) {
            throw new Error(`Edit failed: The exact search block was not found in ${filePath}. Check indentation and whitespaces.`);
        }

        const newContent = content.replace(searchBlock, replaceBlock);
        fs.writeFileSync(absolutePath, newContent, 'utf8');
    }
}

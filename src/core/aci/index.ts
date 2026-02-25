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
        const absolutePath = this.resolveSafePath(filePath);

        if (!fs.existsSync(absolutePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const content = fs.readFileSync(absolutePath, 'utf8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        const hash = this.getFileHash(absolutePath);

        // Apply pagination
        const endLine = Math.min(startLine + maxLines - 1, totalLines);
        const sliced = lines.slice(startLine - 1, endLine);

        // Prefix with line numbers
        const numberedContent = sliced.map((line, idx) => `${startLine + idx}: ${line}`).join('\n');

        return {
            content: numberedContent,
            totalLines,
            truncated: endLine < totalLines,
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

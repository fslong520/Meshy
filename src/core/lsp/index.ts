import { LSPServerManager } from './server.js';
import { LSPClient } from './client.js';
import path from 'path';

export class LSPManager {
    private serverManager = new LSPServerManager();
    // Key format: `${rootPath}:${serverId}`
    private clients: Map<string, LSPClient> = new Map();

    async getClientForFile(filePath: string): Promise<LSPClient | undefined> {
        const ext = path.extname(filePath);
        const serverInfo = this.serverManager.getServerForExtension(ext);
        if (!serverInfo) return undefined;

        // Assuming process.cwd() is the root path for now.
        // In a real project it might be the closest directory containing a package.json or git repo.
        const rootPath = process.cwd();
        const clientKey = `${rootPath}:${serverInfo.id}`;

        if (this.clients.has(clientKey)) {
            return this.clients.get(clientKey);
        }

        const handle = await this.serverManager.spawnServer(serverInfo.id, rootPath);
        if (!handle) return undefined;

        try {
            const client = await LSPClient.create(serverInfo.id, rootPath, handle);
            this.clients.set(clientKey, client);
            return client;
        } catch (error) {
            console.error(`[LSPManager] Failed to create client for ${serverInfo.id}:`, error);
            // Cleanup handle if possible
            handle.process.kill();
            return undefined;
        }
    }

    /**
     * Touch a file: open it, wait a bit, then pull diagnostics.
     */
    async getDiagnostics(filePath: string, sourceCode?: string): Promise<string[]> {
        const client = await this.getClientForFile(filePath);
        if (!client) return [];

        try {
            await client.openDocument(filePath);

            // If new text is provided, push it so LSP knows the latest in-memory state
            // version should ideally be monotonic, we'll just use a timestamp
            if (sourceCode !== undefined) {
                await client.updateDocument(filePath, sourceCode, Date.now());
            }

            // Wait briefly for LSP server to compute diagnostics (they are sent asynchronously)
            await new Promise(resolve => setTimeout(resolve, 1500));

            const limit = 5; // Return top 5 errors
            return client.getDiagnostics(filePath)
                .filter(diag => diag.severity === 1) // 1 = Error
                .slice(0, limit)
                .map(diag => `[Line ${diag.range.start.line + 1}] ${diag.message}`);
        } catch (err) {
            console.error('[LSPManager] Error getting diagnostics:', err);
            return [];
        }
    }

    killAll() {
        for (const client of this.clients.values()) {
            client.shutdown().catch(() => { });
        }
        this.clients.clear();
        this.serverManager.killAll();
    }
}

import { ChildProcess, spawn } from 'child_process';
import path from 'path';

export namespace LSPServer {
    export interface Info {
        id: string;
        extensions: string[];
        spawn: (rootPath: string) => Promise<Handle | undefined>;
    }

    export interface Handle {
        process: ChildProcess;
        initializationOptions?: any;
    }
}

// Pre-configured servers (we start with TypeScript)
export const SUPPORTED_SERVERS: Record<string, LSPServer.Info> = {
    'typescript': {
        id: 'typescript',
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        spawn: async (rootPath: string) => {
            const npxPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';
            const cp = spawn(npxPath, ['typescript-language-server', '--stdio'], {
                cwd: rootPath,
                env: process.env,
                shell: true,
            });
            return {
                process: cp,
                initializationOptions: {
                    hostInfo: 'Meshy LSP Client',
                    preferences: {
                        disableSuggestions: true,
                    }
                }
            };
        }
    }
};

export class LSPServerManager {
    // Map of rootPath -> serverId -> ChildProcess
    private runningServers: Map<string, Map<string, LSPServer.Handle>> = new Map();

    async spawnServer(serverId: string, rootPath: string): Promise<LSPServer.Handle | undefined> {
        const info = SUPPORTED_SERVERS[serverId];
        if (!info) return undefined;

        let rootMap = this.runningServers.get(rootPath);
        if (!rootMap) {
            rootMap = new Map();
            this.runningServers.set(rootPath, rootMap);
        }

        if (rootMap.has(serverId)) {
            return rootMap.get(serverId);
        }

        try {
            const handle = await info.spawn(rootPath);
            if (handle) {
                rootMap.set(serverId, handle);

                handle.process.on('exit', () => {
                    rootMap?.delete(serverId);
                });
            }
            return handle;
        } catch (error) {
            console.error(`[LSPServerManager] Failed to spawn ${serverId}:`, error);
            return undefined;
        }
    }

    getServerForExtension(ext: string): LSPServer.Info | undefined {
        for (const server of Object.values(SUPPORTED_SERVERS)) {
            if (server.extensions.includes(ext)) {
                return server;
            }
        }
        return undefined;
    }

    killAll() {
        for (const rootMap of this.runningServers.values()) {
            for (const handle of rootMap.values()) {
                handle.process.kill();
            }
        }
        this.runningServers.clear();
    }
}

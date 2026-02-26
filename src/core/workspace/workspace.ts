import { MemoryStore } from '../memory/store.js';
import { McpHostRuntime } from '../mcp/host.js';
import { LSPManager } from '../lsp/index.js';
import { SnapshotManager } from '../session/snapshot.js';
import { ReflectionEngine } from '../memory/reflection.js';
import { ILLMProvider } from '../llm/provider.js';
import path from 'path';
import fs from 'fs';
import { RepoMapGenerator } from '../context/repo-map.js';
import { CollaborativeBlackboard } from './blackboard.js';

export interface WorkspaceConfig {
    name: string;
    ignorePaths: string[];
}

export class Workspace {
    public readonly rootPath: string;
    public readonly memoryStore: MemoryStore;
    public readonly mcpHost: McpHostRuntime;
    public readonly lspManager: LSPManager;
    public readonly snapshotManager: SnapshotManager;
    public readonly reflectionEngine: ReflectionEngine;
    public readonly blackboard: CollaborativeBlackboard;

    private config: WorkspaceConfig;
    private repoMapCache: string | null = null;

    constructor(rootPath: string, llmProvider: ILLMProvider, embeddingProvider: any) {
        this.rootPath = path.resolve(rootPath);

        // Ensure .meshy directory exists
        const meshyDir = path.join(this.rootPath, '.meshy');
        if (!fs.existsSync(meshyDir)) {
            fs.mkdirSync(meshyDir, { recursive: true });
        }

        this.config = this.loadConfig();

        // Initialize components bound to this workspace
        this.memoryStore = new MemoryStore(this.rootPath, embeddingProvider);
        this.reflectionEngine = new ReflectionEngine(llmProvider, this.memoryStore);

        this.mcpHost = new McpHostRuntime(this.rootPath);
        this.mcpHost.loadConfig();

        this.lspManager = new LSPManager();
        this.snapshotManager = new SnapshotManager(this.rootPath);
        this.blackboard = new CollaborativeBlackboard(this.rootPath);
    }

    private loadConfig(): WorkspaceConfig {
        const configPath = path.join(this.rootPath, '.meshy', 'workspace.json');
        if (fs.existsSync(configPath)) {
            try {
                return JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } catch (e) {
                console.warn(`[Workspace] Failed to load config at ${configPath}, using defaults.`);
            }
        }
        return {
            name: path.basename(this.rootPath),
            ignorePaths: ['node_modules', '.git', 'dist', '.meshy'],
        };
    }

    public saveConfig() {
        const configPath = path.join(this.rootPath, '.meshy', 'workspace.json');
        fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    }

    public getIgnorePaths(): string[] {
        return this.config.ignorePaths;
    }

    public getRepoMap(): string {
        if (!this.repoMapCache) {
            const generator = new RepoMapGenerator(this.rootPath, { ignorePatterns: this.getIgnorePaths() });
            this.repoMapCache = generator.generate();
        }
        return this.repoMapCache;
    }

    public refreshRepoMap(): void {
        this.repoMapCache = null;
    }

    public dispose() {
        this.lspManager.killAll();
        // Other cleanup if needed
    }
}

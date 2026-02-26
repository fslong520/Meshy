import { Workspace } from './workspace.js';
import { ProviderResolver } from '../llm/resolver.js';
import path from 'path';

export class WorkspaceManager {
    private workspaces: Map<string, Workspace> = new Map();
    private providerResolver: ProviderResolver;

    constructor(providerResolver: ProviderResolver) {
        this.providerResolver = providerResolver;
    }

    public getWorkspace(rootPath: string): Workspace {
        const resolvedPath = path.resolve(rootPath);
        if (this.workspaces.has(resolvedPath)) {
            return this.workspaces.get(resolvedPath)!;
        }

        const llmProvider = this.providerResolver.getProvider();
        const embeddingProvider = this.providerResolver.getEmbeddingProvider();

        const workspace = new Workspace(resolvedPath, llmProvider, embeddingProvider);
        this.workspaces.set(resolvedPath, workspace);
        return workspace;
    }

    public listWorkspaces(): string[] {
        return Array.from(this.workspaces.keys());
    }

    public disposeAll() {
        for (const workspace of this.workspaces.values()) {
            workspace.dispose();
        }
        this.workspaces.clear();
    }
}

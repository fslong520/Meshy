import { Workspace } from './workspace.js';
import { ProviderResolver } from '../llm/resolver.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

const SYSTEM_DIRS = ['.git', '.meshy', 'node_modules', '__pycache__', '.svn', '.hg', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache'];
const HIDDEN_DIRS = ['.', '..'];

export class WorkspaceManager {
    private workspaces: Map<string, Workspace> = new Map();
    private providerResolver: ProviderResolver;
    private registryPath: string;
    private persistedWorkspaces: string[] = [];

    constructor(providerResolver: ProviderResolver) {
        this.providerResolver = providerResolver;
        this.registryPath = path.join(os.homedir(), '.meshy', 'workspaces.json');
        this.loadPersistedWorkspaces();
    }

    private isSystemDir(dirName: string): boolean {
        return SYSTEM_DIRS.includes(dirName) || dirName.startsWith('.');
    }

    private isValidWorkspaceDir(dirPath: string): boolean {
        try {
            const dirName = path.basename(dirPath);
            if (this.isSystemDir(dirName)) {
                return false;
            }
            
            // 检查目录是否可读
            if (!fs.existsSync(dirPath)) {
                return false;
            }
            
            const stat = fs.statSync(dirPath);
            if (!stat.isDirectory()) {
                return false;
            }
            
            // 尝试读取目录（验证访问权限）
            fs.readdirSync(dirPath);
            
            return true;
        } catch {
            return false;
        }
    }

    private loadPersistedWorkspaces() {
        try {
            if (fs.existsSync(this.registryPath)) {
                const data = fs.readFileSync(this.registryPath, 'utf-8');
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    this.persistedWorkspaces = parsed;
                }
            }
        } catch (err) {
            console.error('[WorkspaceManager] Failed to load workspaces registry:', err);
        }
    }

    private savePersistedWorkspaces() {
        try {
            const dir = path.dirname(this.registryPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.registryPath, JSON.stringify(this.persistedWorkspaces, null, 2), 'utf-8');
        } catch (err) {
            console.error('[WorkspaceManager] Failed to save workspaces registry:', err);
        }
    }

    public getWorkspace(rootPath: string): Workspace {
        const resolvedPath = path.resolve(rootPath);

        // Ensure it's tracked in persistence
        this.addWorkspace(resolvedPath);

        if (this.workspaces.has(resolvedPath)) {
            return this.workspaces.get(resolvedPath)!;
        }

        const llmProvider = this.providerResolver.getProvider();
        const embeddingProvider = this.providerResolver.getEmbeddingProvider();

        const workspace = new Workspace(resolvedPath, llmProvider, embeddingProvider);
        this.workspaces.set(resolvedPath, workspace);
        return workspace;
    }

    public addWorkspace(rootPath: string): void {
        const resolvedPath = path.resolve(rootPath);
        
        // 验证路径是否为有效的工作区目录
        if (!this.isValidWorkspaceDir(resolvedPath)) {
            const dirName = path.basename(resolvedPath);
            if (this.isSystemDir(dirName)) {
                throw new Error(`Cannot add system directory "${dirName}" as workspace. Only regular project directories are allowed.`);
            }
            throw new Error(`Directory "${resolvedPath}" is not accessible or does not exist.`);
        }
        
        if (!this.persistedWorkspaces.includes(resolvedPath)) {
            this.persistedWorkspaces.push(resolvedPath);
            this.savePersistedWorkspaces();
        }
    }

    public removeWorkspace(rootPath: string): void {
        const resolvedPath = path.resolve(rootPath);
        this.persistedWorkspaces = this.persistedWorkspaces.filter(p => p !== resolvedPath);
        this.savePersistedWorkspaces();

        // Also cleanup active workspace instance if it exists
        if (this.workspaces.has(resolvedPath)) {
            this.workspaces.get(resolvedPath)!.dispose();
            this.workspaces.delete(resolvedPath);
        }
    }

    public listWorkspaces(): string[] {
        return [...this.persistedWorkspaces];
    }

    public disposeAll() {
        for (const workspace of this.workspaces.values()) {
            workspace.dispose();
        }
        this.workspaces.clear();
    }
}

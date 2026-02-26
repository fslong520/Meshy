import { createProtocolConnection, StreamMessageReader, StreamMessageWriter, Logger, InitializeRequest, InitializeParams, InitializedNotification, DidOpenTextDocumentNotification, DidChangeTextDocumentNotification, DidSaveTextDocumentNotification, PublishDiagnosticsNotification, Diagnostic } from 'vscode-languageserver-protocol/node.js';
import { LSPServer } from './server.js';
import { pathToFileURL } from 'url';
import fs from 'fs';

export class LSPClient {
    private connection: ReturnType<typeof createProtocolConnection>;
    public readonly serverID: string;
    public readonly rootPath: string;

    // Store diagnostics: uri -> Diagnostic[]
    public diagnostics: Map<string, Diagnostic[]> = new Map();

    private isInitialized = false;

    private constructor(serverID: string, rootPath: string, handle: LSPServer.Handle) {
        this.serverID = serverID;
        this.rootPath = rootPath;

        const reader = new StreamMessageReader(handle.process.stdout!);
        const writer = new StreamMessageWriter(handle.process.stdin!);

        const logger: Logger = {
            error: (message) => console.error(`[LSP Client Error] ${message}`),
            warn: (message) => console.warn(`[LSP Client Warn] ${message}`),
            info: (message) => console.log(`[LSP Client Info] ${message}`),
            log: (message) => console.log(`[LSP Client Log] ${message}`)
        };

        this.connection = createProtocolConnection(reader, writer, logger);

        this.connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
            if (params.diagnostics.length > 0 || this.diagnostics.has(params.uri)) {
                this.diagnostics.set(params.uri, params.diagnostics);
            }
        });

        this.connection.listen();
    }

    static async create(serverID: string, rootPath: string, handle: LSPServer.Handle): Promise<LSPClient> {
        const client = new LSPClient(serverID, rootPath, handle);
        await client.initialize(handle.initializationOptions);
        return client;
    }

    private async initialize(initializationOptions: any = {}) {
        const initParams: InitializeParams = {
            processId: process.pid,
            rootUri: pathToFileURL(this.rootPath).href,
            capabilities: {
                workspace: {
                    configuration: true
                },
                textDocument: {
                    synchronization: {
                        dynamicRegistration: true,
                        willSave: true,
                        willSaveWaitUntil: true,
                        didSave: true
                    },
                    publishDiagnostics: {
                        relatedInformation: true,
                        versionSupport: false,
                        tagSupport: { valueSet: [1, 2] }
                    }
                }
            },
            workspaceFolders: [{
                uri: pathToFileURL(this.rootPath).href,
                name: 'workspace'
            }],
            initializationOptions
        };

        await this.connection.sendRequest(InitializeRequest.type, initParams);
        await this.connection.sendNotification(InitializedNotification.type, {});
        this.isInitialized = true;
    }

    public async openDocument(filePath: string) {
        const uri = pathToFileURL(filePath).href;
        const text = fs.readFileSync(filePath, 'utf-8');
        const languageId = this.getLanguageId(filePath);

        await this.connection.sendNotification(DidOpenTextDocumentNotification.type, {
            textDocument: { uri, languageId, version: 1, text }
        });
    }

    public async updateDocument(filePath: string, newText: string, version: number) {
        const uri = pathToFileURL(filePath).href;
        await this.connection.sendNotification(DidChangeTextDocumentNotification.type, {
            textDocument: { uri, version },
            contentChanges: [{ text: newText }]
        });
    }

    public async saveDocument(filePath: string) {
        const uri = pathToFileURL(filePath).href;
        await this.connection.sendNotification(DidSaveTextDocumentNotification.type, {
            textDocument: { uri }
        });
    }

    public getDiagnostics(filePath: string): Diagnostic[] {
        const uri = pathToFileURL(filePath).href;
        return this.diagnostics.get(uri) || [];
    }

    public async shutdown() {
        this.connection.end();
        this.connection.dispose();
    }

    private getLanguageId(filePath: string): string {
        if (filePath.endsWith('.ts')) return 'typescript';
        if (filePath.endsWith('.tsx')) return 'typescriptreact';
        if (filePath.endsWith('.js')) return 'javascript';
        if (filePath.endsWith('.jsx')) return 'javascriptreact';
        if (filePath.endsWith('.json')) return 'json';
        return 'plaintext';
    }
}

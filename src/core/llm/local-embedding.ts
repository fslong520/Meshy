import os from 'os';
import path from 'path';
import fs from 'fs';
// @ts-ignore - The types of @xenova/transformers might need special handling
import { pipeline, env } from '@xenova/transformers';
import { ILLMProvider } from './provider.js';

export class LocalEmbeddingAdapter implements ILLMProvider {
    private embedderPipeline: any = null;
    private initPromise: Promise<void> | null = null;

    // We are using nomic-embed-text-v1.5 which has excellent performance
    // and naturally produces 768 dimensions by default.
    private modelName = 'Xenova/nomic-embed-text-v1.5';

    constructor() {
        // Enforce the user's constraint: Do NOT pollute the repository or tmp directories 
        // with huge payload models. Store them globally at the OS level.
        const meshyGlobalDir = path.join(os.homedir(), '.meshy');
        const modelsDir = path.join(meshyGlobalDir, 'models');

        if (!fs.existsSync(modelsDir)) {
            fs.mkdirSync(modelsDir, { recursive: true });
        }

        // Configure Xenova/transformers environment cache strategy
        env.cacheDir = modelsDir;
        env.localModelPath = modelsDir;
    }

    /**
     * Lazy initialization of the pipeline to avoid blocking the main thread 
     * or eagerly downloading models when not needed.
     */
    private async initializePipeline(): Promise<void> {
        if (this.embedderPipeline) return;

        if (!this.initPromise) {
            this.initPromise = (async () => {
                console.log(`[LocalEmbeddingAdapter] Initializing embedding model: ${this.modelName}`);
                console.log(`[LocalEmbeddingAdapter] Cache directory set to: ${env.cacheDir}`);
                // feature extraction translates to embeddings logic
                this.embedderPipeline = await pipeline('feature-extraction', this.modelName, {
                    // Force the pipeline to download if not present, but use cache if possible
                    quantized: true, // Use int8 quantized versions for memory efficiency
                });
                console.log(`[LocalEmbeddingAdapter] Initialization complete.`);
            })();
        }
        return this.initPromise;
    }

    supportsEmbedding(): boolean {
        return true;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        await this.initializePipeline();

        // Output format: tensor. 'pooling: mean' and 'normalize: true' are standard for RAG
        const output = await this.embedderPipeline(text, {
            pooling: 'mean',
            normalize: true,
        });

        // Output from Xenova feature extraction is usually a Float32Array
        // Convert back to standard array for Turso and normal TS processing
        return Array.from(output.data);
    }

    // Unimplemented completion/stream methods since this is purely a local embedding provider
    async generateResponseStream(
        prompt: any,
        onEvent: (event: any) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        throw new Error("LocalEmbeddingAdapter only supports embeddings. Completion is not implemented.");
    }
}

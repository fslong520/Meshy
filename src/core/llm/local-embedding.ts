import os from 'os';
import path from 'path';
import fs from 'fs';
import { ILLMProvider } from './provider.js';

// 动态导入 @xenova/transformers，避免 sharp 原生模块缺失时阻塞启动
let transformersModule: any = null;
async function getTransformers() {
    if (!transformersModule) {
        try {
            transformersModule = await import('@xenova/transformers');
        } catch (err: any) {
            console.warn(`[LocalEmbeddingAdapter] Warning: @xenova/transformers failed to load (${err.message}). Local embedding will be unavailable.`);
            transformersModule = null;
        }
    }
    return transformersModule;
}

export class LocalEmbeddingAdapter implements ILLMProvider {
    private embedderPipeline: any = null;
    private initPromise: Promise<void> | null = null;

    // We are using bge-base-en-v1.5 which has excellent performance, is completely
    // ungated (unlike Nomic models), and naturally produces 768 dimensions by default.
    private modelName = 'Xenova/bge-base-en-v1.5';

    private modelsDir: string;

    constructor() {
        const meshyGlobalDir = path.join(os.homedir(), '.meshy');
        this.modelsDir = path.join(meshyGlobalDir, 'models');

        if (!fs.existsSync(this.modelsDir)) {
            fs.mkdirSync(this.modelsDir, { recursive: true });
        }
    }

    /**
     * Lazy initialization of the pipeline to avoid blocking the main thread 
     * or eagerly downloading models when not needed.
     */
    private async initializePipeline(): Promise<void> {
        if (this.embedderPipeline) return;

        if (!this.initPromise) {
            this.initPromise = (async () => {
                const tf = await getTransformers();
                if (!tf) {
                    throw new Error('@xenova/transformers is not available. Local embedding cannot be initialized.');
                }
                tf.env.cacheDir = this.modelsDir;
                tf.env.localModelPath = this.modelsDir;

                console.log(`[LocalEmbeddingAdapter] Initializing embedding model: ${this.modelName}`);
                console.log(`[LocalEmbeddingAdapter] Cache directory set to: ${tf.env.cacheDir}`);
                this.embedderPipeline = await tf.pipeline('feature-extraction', this.modelName, {
                    quantized: true,
                });
                console.log(`[LocalEmbeddingAdapter] Initialization complete.`);
            })();
        }
        return this.initPromise;
    }

    supportsEmbedding(): boolean {
        // 乐观返回 true，实际初始化失败会在 initializePipeline 中抛错
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

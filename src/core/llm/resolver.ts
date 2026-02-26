/**
 * Provider Resolver — 模型解析工厂
 *
 * 统一管理系统内的所有 LLM Provider 实例。
 * 支持多 Provider 同时使用、跨协议模型调用、运行时模型切换。
 */

import { ILLMProvider } from './provider.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { Config, ProviderConfig } from '../../config/index.js';

export interface ProviderInfo {
    name: string;
    protocol: string;
    baseUrl?: string;
    hasApiKey: boolean;
}

export class ProviderResolver {
    private config: Config;
    private instances: Map<string, ILLMProvider> = new Map();

    // 当前活跃的默认模型（可运行时切换）
    private activeDefault: string;

    constructor(config: Config) {
        this.config = config;
        this.activeDefault = config.models.default;
    }

    /**
     * 解析 "providerName/modelId" 格式的 target 字符串为 provider 实例。
     *
     * @param target 格式: "providerName/modelId" 或 config.tasks 中的任务名。
     *               如果为空，返回当前活跃的默认 LLM。
     */
    public getProvider(target?: string): ILLMProvider {
        if (!target) {
            return this.resolveFromTarget(this.activeDefault);
        }

        // 1. 尝试按 providerName/modelId 格式解析
        if (target.includes('/')) {
            return this.resolveFromTarget(target);
        }

        // 2. 尝试从 config.tasks 映射
        const taskConfig = this.config.tasks?.[target];
        if (taskConfig) {
            return this.resolveFromTarget(`${taskConfig.provider}/${taskConfig.model}`);
        }

        // 3. Fallback
        return this.resolveFromTarget(this.activeDefault);
    }

    /**
     * 获取支持 Embeddings 的 Provider
     */
    public getEmbeddingProvider(): ILLMProvider {
        // 优先检查是否有 openai 类型的 provider
        for (const [name, cfg] of Object.entries(this.config.providers)) {
            if (cfg.protocol === 'openai') {
                return this.resolveInstance(name, cfg, 'text-embedding-3-small');
            }
        }
        // 如果没有 openai 协议 provider，使用默认
        return this.resolveFromTarget(this.activeDefault);
    }

    /**
     * 运行时切换默认模型
     */
    public switchModel(target: string): void {
        // 验证 provider 存在
        const [providerName] = target.split('/');
        if (!this.config.providers[providerName]) {
            throw new Error(`Provider "${providerName}" not found in config. Available: ${this.listProviderNames().join(', ')}`);
        }
        this.activeDefault = target;
        console.log(`[ProviderResolver] Switched default model to: ${target}`);
    }

    /**
     * 获取当前活跃的默认模型标识符
     */
    public getActiveDefault(): string {
        return this.activeDefault;
    }

    /**
     * 列出所有已配置的 Provider 信息
     */
    public listProviders(): ProviderInfo[] {
        return Object.entries(this.config.providers).map(([name, cfg]) => ({
            name,
            protocol: cfg.protocol,
            baseUrl: cfg.baseUrl,
            hasApiKey: !!cfg.apiKey,
        }));
    }

    /**
     * 列出所有已配置的 Provider 名称
     */
    public listProviderNames(): string[] {
        return Object.keys(this.config.providers);
    }

    // ─── Private ───

    /**
     * 从 "providerName/modelId" 格式解析
     */
    private resolveFromTarget(target: string): ILLMProvider {
        const slashIndex = target.indexOf('/');
        if (slashIndex === -1) {
            throw new Error(`Invalid model target "${target}". Expected format: "providerName/modelId"`);
        }

        const providerName = target.substring(0, slashIndex);
        const modelId = target.substring(slashIndex + 1);

        const providerConfig = this.config.providers[providerName];
        if (!providerConfig) {
            throw new Error(
                `Provider "${providerName}" not found in config.providers. ` +
                `Available providers: [${this.listProviderNames().join(', ')}]`
            );
        }

        return this.resolveInstance(providerName, providerConfig, modelId);
    }

    /**
     * 单例解析核心。缓存 Key 为 "providerName:modelId"
     */
    private resolveInstance(providerName: string, cfg: ProviderConfig, modelId: string): ILLMProvider {
        const cacheKey = `${providerName}:${modelId}`;
        if (this.instances.has(cacheKey)) {
            return this.instances.get(cacheKey)!;
        }

        let instance: ILLMProvider;

        if (cfg.protocol === 'openai') {
            instance = new OpenAIAdapter(cfg.apiKey, modelId, cfg.baseUrl);
        } else if (cfg.protocol === 'anthropic') {
            instance = new AnthropicAdapter(cfg.apiKey, modelId, cfg.baseUrl);
        } else {
            throw new Error(`Unsupported protocol "${cfg.protocol}" for provider "${providerName}".`);
        }

        this.instances.set(cacheKey, instance);
        return instance;
    }
}

/**
 * Provider Resolver — 模型解析工厂
 *
 * 统一管理系统内的所有 LLM Provider 实例。
 * 支持多 Provider 同时使用、跨协议模型调用、运行时模型切换。
 */

import { ILLMProvider } from './provider.js';
import { VercelAIAdapter } from './vercel-ai.js';
import { LocalEmbeddingAdapter } from './local-embedding.js';
import { LocalERNIEAdapter } from './local-ernie.js';
import { Config, ProviderConfig } from '../../config/index.js';

export interface ProviderInfo {
    name: string;
    protocol?: string;
    sdk?: string;
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
     * 获取 Fallback 模型 (Graceful Degradation)
     * 已增强：当用户 API token 耗尽时，自动切换到免费模型。
     */
    public getFallbackProvider(): ILLMProvider | null {
        if (this.config.models.fallback) {
            try {
                return this.resolveFromTarget(this.config.models.fallback);
            } catch (err) {
                console.warn(`[ProviderResolver] Failed to resolve fallback model: ${this.config.models.fallback}`);
            }
        }
        return null;
    }

    /**
     * 获取免费模型（token 用尽时的最终兜底）。
     *
     * 优先级：
     *   1. 用户 config.free.provider 指定的免费 provider（默认 opencode）
     *   2. opencode 免费模型（如果已通过 OPENCODE_API_KEY 配置）
     *   3. 其他已配置的 provider 中任意一个
     *
     * 返回 null 表示无可用免费模型。
     */
    public getFreeProvider(): ILLMProvider | null {
        const freeConfig = this.config.models.free;
        if (!freeConfig || freeConfig.enabled === false) return null;

        // 1. 用户显式指定的免费 provider
        const freeProviderName = freeConfig.provider || 'opencode';
        const freeModels = this._getModelsForProvider(freeProviderName);
        // 优先选择最可靠的免费模型
        const freeModelPriority = ['minimax-m2.5-free', 'hy3-preview-free', 'nemotron-3-super-free', 'big-pickle'];
        const bestModel = freeModelPriority.find(m => freeModels.includes(m)) || freeModels[0];

        if (bestModel) {
            try {
                return this.resolveFromTarget(`${freeProviderName}/${bestModel}`);
            } catch {
                // fall through
            }
        }

        // 2. 遍历所有已配置的 provider 找一个可用的
        for (const [name, cfg] of Object.entries(this.config.providers)) {
            if (!cfg.apiKey || cfg.apiKey.startsWith('sk-placeholder') || cfg.apiKey.startsWith('placeholder')) {
                continue; // 跳过占位符 key
            }
            const models = this._getModelsForProvider(name);
            if (models.length > 0) {
                try {
                    return this.resolveFromTarget(`${name}/${models[0]}`);
                } catch {
                    continue;
                }
            }
        }

        return null;
    }

    /**
     * 判断错误消息是否为 token 耗尽 / 限额不足
     */
    public static isTokenExhaustionError(message: string): boolean {
        const exhaustionPatterns = [
            'insufficient_quota', 'insufficient funding', 'exceeded',
            'billing', '429', '402', '403', 'payment required',
            'quota', 'rate limit', 'token limit', 'max budget',
            'credits exhausted', 'no credits', 'billing threshold',
            'account disabled', 'access denied', 'forbidden',
            'you do not have access', 'not enough credits',
            'payment', 'suspended',
        ];
        const lower = message.toLowerCase();
        return exhaustionPatterns.some(p => lower.includes(p));
    }

    /**
     * 获取指定 provider 的可用模型列表
     */
    private _getModelsForProvider(providerName: string): string[] {
        const cfg = this.config.providers[providerName];
        if (!cfg) return [];

        const models: string[] = [];
        // 检查 config.providers[providerName].models 中的 key
        if (cfg.models) {
            models.push(...Object.keys(cfg.models));
        }
        // 通过 config.models.default/fallback/small 推断
        for (const key of ['default', 'fallback', 'small'] as const) {
            const modelStr = this.config.models[key];
            if (modelStr && modelStr.startsWith(`${providerName}/`)) {
                const modelId = modelStr.substring(providerName.length + 1);
                if (!models.includes(modelId)) {
                    models.push(modelId);
                }
            }
        }
        return models;
    }

    /**
     * 获取支持 Embeddings 的 Provider
     */
    public getEmbeddingProvider(): ILLMProvider | null {
        // 第一优先级：用户显式配置的 embedding 模型
        if (this.config.models.embedding) {
            try {
                const provider = this.resolveFromTarget(this.config.models.embedding);
                if (provider.supportsEmbedding()) {
                    return provider;
                }
            } catch (err) {
                console.warn(`[ProviderResolver] Failed to resolve embedding model ${this.config.models.embedding}`, err);
            }
        }

        // 第二优先级：尝试寻找 openai 协议的 provider 降级使用 text-embedding-3-small
        for (const [name, cfg] of Object.entries(this.config.providers)) {
            if (cfg.protocol === 'openai') {
                return this.resolveInstance(name, cfg, 'text-embedding-3-small');
            }
        }

        // 最终兜底：利用纯本地加载的 LocalEmbeddingAdapter (无需 API key, 无网络开销)
        console.log(`[ProviderResolver] No explicit config or OpenAI provider found. Falling back to LocalEmbeddingAdapter (WASM).`);
        return new LocalEmbeddingAdapter();
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
            sdk: cfg.sdk,
            baseUrl: cfg.baseUrl,
            hasApiKey: !!cfg.apiKey && !cfg.apiKey.startsWith('placeholder'),
        }));
    }

    // 缓存拉取到的可用模型列表
    private cachedModels: Record<string, { protocol: string, models: string[] }> | null = null;

    public async listModelsAsync(): Promise<Record<string, { protocol: string, models: string[] }>> {
        if (this.cachedModels) {
            return this.cachedModels;
        }

        // 从 config.models 中按 provider 分组提取的兜底模型
        const configModelsByProvider = this.extractConfigModels();
        const result: Record<string, { protocol: string, models: string[] }> = {};

        for (const [name, cfg] of Object.entries(this.config.providers)) {
            let models: string[] = [];

            // 优化：如果 config 中已经指定了该 provider 的模型（例如在 default/fallback/small 中明确写出），
            // 直接采用作为初始列表，完全砍掉对 /v1/models 的网络拉取。
            // 适用于大部分中转商（如 Zeabur/DeepSeek），用户通常已经在 config 配置了首选模型。
            if (configModelsByProvider[name] && configModelsByProvider[name].length > 0) {
                models = [...configModelsByProvider[name]];
            } else {
                // 仅当配置中没有任何该 provider 的线索时，才尝试动态拉取
                try {
                    const provider = this.resolveInstance(name, cfg, 'dummy-model-for-list');
                    if (provider.listModelsAsync) {
                        models = await provider.listModelsAsync();
                    }
                } catch (e) {
                    console.warn(`[ProviderResolver] Failed to list models for provider ${name}:`, e instanceof Error ? e.message : e);
                }
            }

            // 确保当前活跃的 default model 也在列表中
            const [defaultProvider, defaultModelId] = this.activeDefault.split('/');
            if (name === defaultProvider && !models.includes(defaultModelId)) {
                models.unshift(defaultModelId);
            }

            result[name] = { protocol: cfg.protocol || cfg.sdk || 'unknown', models };
        }

        this.cachedModels = result;
        return result;
    }

    /**
     * 从 config.models (default/fallback/small) 中提取各 provider 下的模型 ID
     */
    private extractConfigModels(): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        const entries = [
            this.config.models.default,
            this.config.models.fallback,
            this.config.models.small,
        ].filter(Boolean);

        for (const entry of entries) {
            const slashIdx = entry.indexOf('/');
            if (slashIdx === -1) continue;
            const provider = entry.substring(0, slashIdx);
            const modelId = entry.substring(slashIdx + 1);
            if (!result[provider]) result[provider] = [];
            if (!result[provider].includes(modelId)) {
                result[provider].push(modelId);
            }
        }

        // 提取各 provider 下定义的 models 列表
        for (const [providerName, cfg] of Object.entries(this.config.providers)) {
            if (cfg.models) {
                if (!result[providerName]) result[providerName] = [];
                for (const modelId of Object.keys(cfg.models)) {
                    if (!result[providerName].includes(modelId)) {
                        result[providerName].push(modelId);
                    }
                }
            }
        }

        return result;
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

        // 优先级：显式配置的 sdk (包名) > legacy protocol
        const sdkOrProtocol = cfg.sdk || cfg.protocol;

        if (!sdkOrProtocol) {
            throw new Error(`Provider "${providerName}" has neither "sdk" nor "protocol" configured.`);
        }

        // 本地 ERNIE 模型走特殊路径
        if (sdkOrProtocol === '_local_ernie_') {
            instance = new LocalERNIEAdapter();
        } else {
            instance = new VercelAIAdapter(sdkOrProtocol, cfg.apiKey || '', modelId, cfg.baseUrl);
        }

        this.instances.set(cacheKey, instance);
        return instance;
    }
}

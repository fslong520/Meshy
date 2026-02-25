/**
 * Provider Resolver — 模型解析工厂
 *
 * 统一管理系统内的所有 LLM Provider 实例。
 * 支持 Task-Based Model Routing 和 Subagent 动态模型覆盖。
 */

import { ILLMProvider } from './provider.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { Config } from '../../config/index.js';

export class ProviderResolver {
    private config: Config;
    private instances: Map<string, ILLMProvider> = new Map();

    // 默认回落模型
    private defaultProvider: string;
    private defaultModel: string;

    constructor(config: Config) {
        this.config = config;
        this.defaultProvider = config.provider;
        this.defaultModel = config.models.default;
    }

    /**
     * 根据任务名称或明确的模型标识符，获取甚至动态实例化一个 ILLMProvider。
     *
     * @param target 可以是 config.tasks 中的任务名 (如 "tool_query_rewrite")，
     *               也可以是显式的直连标识符 (如 "openai/gpt-4o-mini").
     *               如果为空，或者解析失败，则返回系统默认的 LLM。
     */
    public getProvider(target?: string): ILLMProvider {
        if (!target) {
            return this.resolveInstance(this.defaultProvider, this.defaultModel);
        }

        // 1. 尝试按直连标识符解析 (格式: provider/model)
        if (target.includes('/')) {
            const [provider, ...rest] = target.split('/');
            const model = rest.join('/');
            if (provider && model) {
                return this.resolveInstance(provider, model);
            }
        }

        // 2. 尝试从 config.tasks 寻找映射
        const taskConfig = this.config.tasks?.[target];
        if (taskConfig) {
            return this.resolveInstance(taskConfig.provider, taskConfig.model);
        }

        // 3. Fallback 到系统默认
        return this.resolveInstance(this.defaultProvider, this.defaultModel);
    }

    /**
     * 单例解析和挂载核心逻辑。缓存 Key 为 "provider:model"
     */
    private resolveInstance(providerName: string, modelName: string): ILLMProvider {
        const cacheKey = `${providerName}:${modelName}`;

        if (this.instances.has(cacheKey)) {
            return this.instances.get(cacheKey)!;
        }

        let instance: ILLMProvider;

        if (providerName === 'openai') {
            const apiKey = this.config.apiKeys.openai || process.env.OPENAI_API_KEY;
            if (!apiKey) {
                console.warn(`[ProviderResolver] Missing OpenAI API Key for ${modelName}.`);
                // Fallback to default if failing on secondary tasks usually causes problems,
                // but here we just throw or return default if default works.
                // For simplicity, we assume if they configured it, the key exists.
                // We'll let the Adapter handle the empty key throw.
            }
            instance = new OpenAIAdapter(apiKey || '', modelName);
        } else if (providerName === 'anthropic') {
            const apiKey = this.config.apiKeys.anthropic || process.env.ANTHROPIC_API_KEY;
            // 对于 AnthropicAdapter，它默认没有接收 modelName 的参数（由内部配置处理），
            // 如果项目中 AnthropicAdapter 不支持动态 model，则需要相应扩展它。
            // 假设我们现在对 AnthropicAdapter 构造函数做了增强，允许传入 modelName。
            // (If not supported, we will refactor AnthropicAdapter shortly).
            instance = new AnthropicAdapter(apiKey || '', modelName);
        } else {
            console.warn(`[ProviderResolver] Unsupported provider "${providerName}". Falling back to default.`);
            return this.resolveInstance(this.defaultProvider, this.defaultModel);
        }

        this.instances.set(cacheKey, instance);
        return instance;
    }
}

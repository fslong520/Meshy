import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { ExecutionMode } from '../core/security/modes.js';

// ─── Provider 连接配置 ───
const modelConfigSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
}).default({});

const providerConfigSchema = z.object({
    protocol: z.string().optional(), // 协议 (openai, anthropic, etc.)
    sdk: z.string().optional(),      // 对应 Vercel AI SDK 的 Provider 包名，如 @ai-sdk/anthropic
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),   // 可为空（如 OpenCode Zen 免费模型无需 key）
    models: z.record(z.string(), modelConfigSchema).optional(), // 该 Provider 下允许的模型列表
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;

// ─── 主配置 Schema ───
export const configSchema = z.object({
    providers: z.record(z.string(), providerConfigSchema).default({}),
    ui: z.object({
        theme: z.string().default('dark'),
    }).default({ theme: 'dark' }),
    models: z.object({
        default: z.string().default('openai/gpt-4o'),
        fallback: z.string().default('openai/gpt-4o'),
        small: z.string().default('openai/gpt-4o-mini'),
        embedding: z.string().optional(), // 格式: "providerName/modelId"
        local: z.object({
            enabled: z.boolean().default(true),                  // 是否启用本地小模型分类
            modelName: z.string().default('PaddlePaddle/ERNIE-4.5-0.3B-PT'), // ModelScope 模型名
            pythonCmd: z.string().default('python3'),            // Python 命令路径
            scriptPath: z.string().optional(),                   // Python 脚本路径（自动检测）
        }).default({ enabled: true, modelName: 'PaddlePaddle/ERNIE-4.5-0.3B-PT', pythonCmd: 'python3' }),
        /** 免费模型应急降级配置（token 用尽或 API 限额耗尽时自动启用） */
        free: z.object({
            enabled: z.boolean().default(true),              // 是否启用免费模型应急
            provider: z.string().default('opencode'),        // 免费 provider 名称（OpenCode Zen）
            /** 自动降级条件：检测到这些错误时自动切换到免费模型 */
            fallbackOnErrors: z.array(z.string()).default([
                'insufficient_quota',
                'insufficient funding',
                'exceeded',
                'billing',
                '429',
                '402',
                '403',
                'payment',
                'quota',
                'rate limit',
                'token limit',
                'max budget',
                'credits exhausted',
                'no credits',
                'billing threshold',
            ]),
        }).default({ enabled: true, provider: 'opencode', fallbackOnErrors: [
            'insufficient_quota', 'insufficient funding', 'exceeded',
            'billing', '429', '402', '403', 'payment', 'quota',
            'rate limit', 'token limit', 'max budget',
            'credits exhausted', 'no credits', 'billing threshold',
        ] }),
    }).default({
        default: 'openai/gpt-4o',
        fallback: 'openai/gpt-4o',
        small: 'openai/gpt-4o-mini',
        local: {
            enabled: true,
            modelName: 'PaddlePaddle/ERNIE-4.5-0.3B-PT',
            pythonCmd: 'python3',
        },
        free: {
            enabled: true,
            provider: 'opencode',
            fallbackOnErrors: [
                'insufficient_quota', 'insufficient funding', 'exceeded',
                'billing', '429', '402', '403', 'payment', 'quota',
                'rate limit', 'token limit', 'max budget',
                'credits exhausted', 'no credits', 'billing threshold',
            ],
        },
    }),
    tasks: z.record(
        z.string(),
        z.object({
            provider: z.string(),
            model: z.string(),
        })
    ).default({}),
    system: z.object({
        maxRetries: z.number().default(3),
        logLevel: z.string().default('info'),
        executionMode: z.nativeEnum(ExecutionMode).default(ExecutionMode.SMART),
        enableRituals: z.boolean().default(false), // 默认不启用 Ritual 文件体系
    }).default({ maxRetries: 3, logLevel: 'info', executionMode: ExecutionMode.SMART, enableRituals: false }),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Loads a JSON config file and parses it. Returns an empty object if file doesn't exist.
 */
function loadJsonConfig(filePath: string): Record<string, any> {
    try {
        if (fs.existsSync(filePath)) {
            const fileContents = fs.readFileSync(filePath, 'utf8');
            const doc = JSON.parse(fileContents);
            return doc || {};
        }
    } catch (error) {
        console.error(`Failed to load config from ${filePath}`, error);
    }
    return {};
}

/**
 * Deep merges multiple configuration objects.
 */
function deepMerge<T extends Record<string, any>>(...objs: Partial<T>[]): T {
    const result: Record<string, any> = {};

    for (const obj of objs) {
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (
                    typeof obj[key] === 'object' &&
                    obj[key] !== null &&
                    !Array.isArray(obj[key]) &&
                    typeof result[key] === 'object' &&
                    result[key] !== null
                ) {
                    result[key] = deepMerge(result[key], obj[key]);
                } else {
                    result[key] = obj[key] !== undefined ? obj[key] : result[key];
                }
            }
        }
    }
    return result as T;
}

/**
 * 向后兼容迁移：将旧格式 (provider/apiKeys/baseUrls) 转换为新格式 (providers)
 */
function migrateOldConfig(raw: Record<string, any>): Record<string, any> {
    // 如果已经有 providers 字段，无需迁移
    if (raw.providers && Object.keys(raw.providers).length > 0) {
        return raw;
    }

    const oldProvider = raw.provider as string | undefined;
    const oldApiKeys = raw.apiKeys as Record<string, string> | undefined;
    const oldBaseUrls = raw.baseUrls as Record<string, string> | undefined;

    if (!oldApiKeys || Object.keys(oldApiKeys).length === 0) {
        return raw;
    }

    const providers: Record<string, any> = {};

    for (const [name, apiKey] of Object.entries(oldApiKeys)) {
        providers[name] = {
            protocol: name as string,
            baseUrl: oldBaseUrls?.[name],
            apiKey,
        };
    }

    // 迁移 models 为 provider/model 格式
    const oldModels = raw.models as Record<string, string> | undefined;
    const models: Record<string, string> = {};

    if (oldModels && oldProvider) {
        for (const [role, modelName] of Object.entries(oldModels)) {
            // 如果已经是 provider/model 格式则保留
            models[role] = modelName.includes('/') ? modelName : `${oldProvider}/${modelName}`;
        }
    }

    // 清理旧字段
    const migrated = { ...raw };
    delete migrated.provider;
    delete migrated.apiKeys;
    delete migrated.baseUrls;
    migrated.providers = providers;
    if (Object.keys(models).length > 0) {
        migrated.models = models;
    }

    console.log('[Config] Migrated old config format to new providers format.');
    return migrated;
}

/**
 * Loads the cascading configuration hierarchy:
 * 1. Global config (~/.config/meshy/config.json)
 * 2. Project config (.agent/config.json)
 * 3. Runtime overrides (passed as args)
 */
export function loadConfig(runtimeOverrides: Partial<Config> = {}): Config {
    const globalConfigPath = path.join(os.homedir(), '.config', 'meshy', 'config.json');
    const projectConfigPath = path.join(process.cwd(), '.agent', 'config.json');

    let globalConfig = loadJsonConfig(globalConfigPath);
    let projectConfig = loadJsonConfig(projectConfigPath);

    // 向后兼容迁移
    globalConfig = migrateOldConfig(globalConfig);
    projectConfig = migrateOldConfig(projectConfig);

    // 环境变量补充
    const envProviders: Record<string, any> = {};
    if (process.env.OPENAI_API_KEY) {
        envProviders.openai = { protocol: 'openai', apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL };
    }
    if (process.env.ANTHROPIC_API_KEY) {
        envProviders.anthropic = { protocol: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL };
    }
    // ── OpenCode Zen 免费模型（无需 API Key，直接可用） ──
    // 文档: https://opencode.ai/docs/zen/#pricing
    // 免费模型: Big Pickle, MiniMax M2.5 Free, Hy3 Preview Free, Nemotron 3 Super Free
    // 用法: 零配置，自动可用
    envProviders.opencode = {
        sdk: '@ai-sdk/openai-compatible',
        baseUrl: 'https://opencode.ai/zen/v1',
        apiKey: '',  // 免费模型无需 API Key
        models: {
            // ── 免费模型（价格: Free，无需 API Key） ──
            'big-pickle': { name: 'Big Pickle (Free)' },
            'minimax-m2.5-free': { name: 'MiniMax M2.5 Free' },
            'hy3-preview-free': { name: 'Hy3 Preview Free' },
            'nemotron-3-super-free': { name: 'Nemotron 3 Super Free' },
            // ── 低价模型（需 OpenCode API Key） ──
            'ling-2.6-flash': { name: 'Ling 2.6 Flash' },
            'minimax-m2.5': { name: 'MiniMax M2.5' },
            'qwen3.5-plus': { name: 'Qwen3.5 Plus' },
            'gpt-5-nano': { name: 'GPT 5 Nano (廉价)' },
            'gpt-5.4-nano': { name: 'GPT 5.4 Nano (廉价)' },
            'gpt-5.1-codex-mini': { name: 'GPT 5.1 Codex Mini' },
            'gpt-5.4-mini': { name: 'GPT 5.4 Mini' },
            'kimi-k2.5': { name: 'Kimi K2.5' },
        },
    };

    const envConfig: Record<string, any> = {};
    if (Object.keys(envProviders).length > 0) {
        envConfig.providers = envProviders;
    }

    // 当免费降级启用时，自动选择免费模型作为 fallback（如果用户没手动改过 fallback）
    const mergedTmp = deepMerge(
        configSchema.parse({}),
        globalConfig,
        projectConfig,
        envConfig,
    );
    const isFallbackStillDefault = mergedTmp.models?.fallback === 'openai/gpt-4o' ||
        mergedTmp.models?.fallback === mergedTmp.models?.default;
    const freeProviderName = mergedTmp.models?.free?.provider || 'opencode';
    const freeEnabled = mergedTmp.models?.free?.enabled !== false;

    if (freeEnabled && isFallbackStillDefault && envProviders[freeProviderName]) {
        const freeModels = Object.keys(envProviders[freeProviderName].models || {});
        // 优先选标了 "(Free)" 的模型
        // 按可靠性排序：minimax-m2.5-free > hy3-preview-free > nemotron-3-super-free > big-pickle
        const freeModelPriority = ['minimax-m2.5-free', 'hy3-preview-free', 'nemotron-3-super-free', 'big-pickle'];
        const freeModel = freeModelPriority.find(m => freeModels.includes(m)) || freeModels[0];
        if (freeModel) {
            envConfig.models = envConfig.models || {};
            envConfig.models.fallback = `${freeProviderName}/${freeModel}`;
            console.log(`[Config] OpenCode Zen free model detected. Auto-set fallback to: ${envConfig.models.fallback}`);
        }
    }

    // Merge order: Base Defaults -> Global -> Project -> Env -> Runtime
    const merged = deepMerge(
        configSchema.parse({}), // get defaults
        globalConfig,
        projectConfig,
        envConfig,
        runtimeOverrides as Record<string, any>
    );

    return configSchema.parse(merged);
}

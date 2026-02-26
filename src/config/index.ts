import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { ExecutionMode } from '../core/security/modes.js';

// ─── Provider 连接配置 ───
const providerConfigSchema = z.object({
    protocol: z.enum(['openai', 'anthropic']),
    baseUrl: z.string().optional(),
    apiKey: z.string(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

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
    }).default({ default: 'openai/gpt-4o', fallback: 'openai/gpt-4o', small: 'openai/gpt-4o-mini' }),
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
    }).default({ maxRetries: 3, logLevel: 'info', executionMode: ExecutionMode.SMART }),
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

    const envConfig: Record<string, any> = {};
    if (Object.keys(envProviders).length > 0) {
        envConfig.providers = envProviders;
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

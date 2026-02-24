import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';

// Define the configuration schema using Zod
export const configSchema = z.object({
    provider: z.string().default('openai'),
    apiKeys: z.record(z.string(), z.string()).default({}),
    ui: z.object({
        theme: z.string().default('dark'),
    }).default({ theme: 'dark' }),
    models: z.object({
        default: z.string().default('gpt-4o'),
        fallback: z.string().default('claude-3-5-sonnet-20240620'),
        small: z.string().default('gpt-4o-mini'),
    }).default({ default: 'gpt-4o', fallback: 'claude-3-5-sonnet-20240620', small: 'gpt-4o-mini' }),
    system: z.object({
        maxRetries: z.number().default(3),
        logLevel: z.string().default('info'),
    }).default({ maxRetries: 3, logLevel: 'info' }),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Loads a JSON config file and parses it. Returns an empty object if file doesn't exist.
 */
function loadJsonConfig(filePath: string): Partial<Config> {
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
 * Loads the cascading configuration hierarchy:
 * 1. Global config (~/.config/meshy/config.json)
 * 2. Project config (.agent/config.json)
 * 3. Runtime overrides (passed as args)
 */
export function loadConfig(runtimeOverrides: Partial<Config> = {}): Config {
    const globalConfigPath = path.join(os.homedir(), '.config', 'meshy', 'config.json');
    const projectConfigPath = path.join(process.cwd(), '.agent', 'config.json');

    const globalConfig = loadJsonConfig(globalConfigPath);
    const projectConfig = loadJsonConfig(projectConfigPath);

    // Parse environment variables that start with MESHY_
    // Specific mappings could be added here.
    const envConfig: Partial<Config> = {};
    if (process.env.MESHY_PROVIDER) {
        envConfig.provider = process.env.MESHY_PROVIDER;
    }

    // Merge order: Base Defaults -> Global -> Project -> Env -> Runtime
    const merged = deepMerge(
        configSchema.parse({}), // get defaults
        globalConfig,
        projectConfig,
        envConfig,
        runtimeOverrides
    );

    return configSchema.parse(merged);
}

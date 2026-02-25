import { loadConfig } from './config/index.js';
import { OpenAIAdapter } from './core/llm/openai.js';
import { AnthropicAdapter } from './core/llm/anthropic.js';
import { Session } from './core/session/state.js';
import { TaskEngine } from './core/engine/index.js';
import { ILLMProvider } from './core/llm/provider.js';

export async function runMeshy(prompt: string) {
    // 1. Load configuration
    const config = loadConfig();
    console.log(`[Meshy] Loaded Config. Provider: ${config.provider}`);

    // 2. Initialize the Provider Resolver
    const { ProviderResolver } = await import('./core/llm/resolver.js');
    const providerResolver = new ProviderResolver(config);

    // 3. Initialize Session & Blackboard
    const session = new Session('session-' + Date.now());

    // 4. Start Task Engine
    const engine = new TaskEngine(providerResolver, session, {
        maxRetries: config.system.maxRetries
    });

    console.log(`[Meshy] Starting task...`);
    await engine.runTask(prompt);
    console.log(`\n[Meshy] Task completed or suspended.`);
}

// CLI entry point stub
const isMainModule = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMainModule) {
    const userPrompt = process.argv.slice(2).join(' ') || 'Hello, are you ready?';
    runMeshy(userPrompt).catch(console.error);
}

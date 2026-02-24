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

    // 2. Initialize the Provider Gateway
    let provider: ILLMProvider;
    if (config.provider === 'openai') {
        const apiKey = config.apiKeys.openai || process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OpenAI API Key is missing.');
        provider = new OpenAIAdapter(apiKey, config.models.default);
    } else if (config.provider === 'anthropic') {
        const apiKey = config.apiKeys.anthropic || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error('Anthropic API Key is missing.');
        provider = new AnthropicAdapter(apiKey);
    } else {
        throw new Error(`Unsupported provider: ${config.provider}`);
    }

    // 3. Initialize Session & Blackboard
    const session = new Session('session-' + Date.now());

    // 4. Start Task Engine
    const engine = new TaskEngine(provider, session, {
        maxRetries: config.system.maxRetries
    });

    console.log(`[Meshy] Starting task...`);
    await engine.runTask(prompt);
    console.log(`\n[Meshy] Task completed or suspended.`);
}

// CLI entry point stub
if (import.meta.url.startsWith('file:') && process.argv[1] === new URL(import.meta.url).pathname) {
    const userPrompt = process.argv.slice(2).join(' ') || 'Hello, are you ready?';
    runMeshy(userPrompt).catch(console.error);
}

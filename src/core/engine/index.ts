import { ILLMProvider, StandardPrompt } from '../llm/provider.js';
import { AgentComputerInterface } from '../aci/index.js';
import { Session } from '../session/state.js';
import { loadConfig } from '../../config/index.js';

export interface EngineOptions {
    maxRetries?: number;
}

export class TaskEngine {
    private llm: ILLMProvider;
    private aci: AgentComputerInterface;
    private session: Session;
    private maxRetries: number;

    constructor(llm: ILLMProvider, session: Session, options: EngineOptions = {}) {
        this.llm = llm;
        this.session = session;
        this.aci = new AgentComputerInterface();
        const config = loadConfig();
        this.maxRetries = options.maxRetries || config.system.maxRetries || 3;
    }

    /**
     * Main execution loop for an Agent Task.
     * Runs the LLM generation and handles Tool Calling automatically
     * until the LLM decides the task is 'done'.
     */
    public async runTask(userPrompt: string): Promise<void> {
        this.session.addMessage({ role: 'user', content: userPrompt });

        let isDone = false;
        let retries = 0;

        while (!isDone && retries < this.maxRetries) {
            try {
                const prompt: StandardPrompt = {
                    systemPrompt: 'You are an advanced AI Agent. Utilize tools carefully to assist the user.',
                    messages: this.session.history,
                    tools: this.getAvailableTools(),
                };

                const currentToolCall: any = { id: '', name: '', rawArgs: '' };
                let fullResponseText = '';

                await this.llm.generateResponseStream(prompt, (event) => {
                    if (event.type === 'text') {
                        fullResponseText += event.data;
                        process.stdout.write(event.data);
                    } else if (event.type === 'tool_call_start') {
                        currentToolCall.id = event.data.id;
                        currentToolCall.name = event.data.name;
                        process.stdout.write(`\n[Agent]: Call Tool ${currentToolCall.name}...\n`);
                    } else if (event.type === 'tool_call_chunk') {
                        currentToolCall.rawArgs += event.data;
                    } else if (event.type === 'tool_call_end') {
                        // We will handle the execution after the stream finishes for simplicity
                    } else if (event.type === 'done') {
                        isDone = true;
                    } else if (event.type === 'error') {
                        console.error('\n[AgentStreamError]:', event.data);
                    }
                });

                // Add the Assistant's content reply if any
                if (fullResponseText.trim() || currentToolCall.id === '') {
                    // If there's text but no tool call
                    if (!currentToolCall.id) {
                        this.session.addMessage({ role: 'assistant', content: fullResponseText });
                        isDone = true; // Natural end
                        break;
                    }
                }

                // If the LLM requested a tool
                if (currentToolCall.id) {
                    isDone = false; // We have to run the tool and loop back
                    this.session.addMessage({
                        role: 'assistant',
                        content: {
                            type: 'tool_call',
                            id: currentToolCall.id,
                            name: currentToolCall.name,
                            arguments: currentToolCall.rawArgs ? JSON.parse(currentToolCall.rawArgs) : {}
                        }
                    });

                    // Execute Tool
                    const result = await this.executeTool(
                        currentToolCall.name,
                        currentToolCall.rawArgs ? JSON.parse(currentToolCall.rawArgs) : {}
                    );

                    this.session.addMessage({
                        role: 'user',
                        content: {
                            type: 'tool_result',
                            id: currentToolCall.id,
                            content: result
                        }
                    });
                }

            } catch (err: any) {
                retries++;
                console.error(`\n[Engine Error] Retrying (${retries}/${this.maxRetries})...`, err.message);
                this.session.addMessage({
                    role: 'user',
                    content: `System Error encountered: ${err.message}. Please self-correct or ask user for help.`
                });
            }
        }

        if (retries >= this.maxRetries) {
            console.warn('\n[Engine Warning] Hit max retries limit. Suspending Task.');
        }
    }

    private getAvailableTools() {
        return [
            {
                name: 'readFile',
                description: 'Read the contents of a file with line numbers.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                        startLine: { type: 'number' },
                        maxLines: { type: 'number' }
                    },
                    required: ['filePath']
                }
            },
            {
                name: 'editFile',
                description: 'Replaces a specific block of text in a file for exact matches. Always use readFile first to get expectedHash.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                        expectedHash: { type: 'string' },
                        searchBlock: { type: 'string' },
                        replaceBlock: { type: 'string' }
                    },
                    required: ['filePath', 'expectedHash', 'searchBlock', 'replaceBlock']
                }
            }
        ];
    }

    private async executeTool(name: string, args: any): Promise<string> {
        try {
            if (name === 'readFile') {
                const res = this.aci.readFile(args.filePath, args.startLine, args.maxLines);
                return JSON.stringify(res);
            } else if (name === 'editFile') {
                this.aci.editFile(args.filePath, args.expectedHash, args.searchBlock, args.replaceBlock);
                return `Successfully edited ${args.filePath}`;
            } else {
                return `Error: Tool ${name} not found.`;
            }
        } catch (e: any) {
            return `Error executing ${name}: ${e.message}`;
        }
    }
}

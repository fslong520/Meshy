/**
 * LocalERNIEAdapter — 本地 ERNIE-4.5-0.3B 意图分类引擎
 *
 * 本适配器通过 Python 子进程加载 ERNIE-4.5-0.3B 小模型（约 0.3B 参数），
 * 在本地完成用户意图的快速分类，然后再将具体执行交由大模型处理。
 * 这遵循了 "小模型分类、大模型执行" 的分层架构思想。
 *
 * 设计要点：
 * - 启动一个常驻 Python 子进程（ernie_intent_server.py）
 * - 通过 stdin/stdout 以 JSON-RPC 风格通信
 * - 懒加载：模型在首次分类请求时才被加载到内存
 * - 降级：Python 环境或模型不可用时，自动回退到纯关键词匹配
 * - 超时保护：防止子进程响应过慢阻塞主线程
 *
 * 参考 LocalEmbeddingAdapter 的模式，本适配器也采用
 * "先依赖检测，后懒加载"的策略，确保不阻塞系统启动。
 */

import { ILLMProvider, StandardPrompt, AgentMessageEvent, StandardMessage } from './provider.js';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createInterface } from 'readline';

// ─── 意图分类结果接口 ───

export interface IntentClassification {
    intent: string;
    confidence: number;
    reasoning?: string;
}

export interface HealthStatus {
    loaded: boolean;
    model: string;
    error: string | null;
    categories: string[];
}

// ─── 请求/响应 ID 生成 ───

let requestCounter = 0;
function nextId(): string {
    return `ernie_${Date.now()}_${++requestCounter}`;
}

// ─── 超时控制 ───

const REQUEST_TIMEOUT_MS = 20_000; // 单次分类请求超时 20s
const CHAT_TIMEOUT_MS = 120_000;   // chat 生成请求超时 120s（CPU 推理慢）

// ─── 适配器实现 ───

export class LocalERNIEAdapter implements ILLMProvider {
    private pythonProcess: ChildProcess | null = null;
    private rl: ReturnType<typeof createInterface> | null = null;

    /** 待处理的请求 Map: id -> { resolve, reject, timer } */
    private pendingRequests = new Map<
        string,
        {
            resolve: (value: any) => void;
            reject: (reason: any) => void;
            timer: NodeJS.Timeout;
        }
    >();

    private processPath: string;
    private started = false;
    private starting = false;

    /** 并发锁，防止同时发出多个启动请求 */
    private startPromise: Promise<void> | null = null;

    constructor() {
        // 在 meshy 项目树中定位 Python 脚本
        const searchPaths = [
            path.resolve(__dirname, '..', '..', '..', 'scripts', 'ernie_intent_server.py'),
            path.resolve(process.cwd(), 'scripts', 'ernie_intent_server.py'),
            path.resolve(__dirname, '..', '..', 'scripts', 'ernie_intent_server.py'),
        ];

        let resolvedPath = '';
        for (const p of searchPaths) {
            if (fs.existsSync(p)) {
                resolvedPath = p;
                break;
            }
        }

        if (!resolvedPath) {
            console.warn('[LocalERNIEAdapter] Python script not found. Attempting relative path:', searchPaths[0]);
            resolvedPath = searchPaths[0]; // 尝试用第一个路径，即使不存在
        }

        this.processPath = resolvedPath;
    }

    /**
     * 启动 Python 子进程（首次请求时自动调用）
     */
    private async ensureStarted(): Promise<void> {
        if (this.started) return;
        if (this.startPromise) return this.startPromise;

        this.startPromise = this._startProcess();
        return this.startPromise;
    }

    private _startProcess(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.started) {
                resolve();
                return;
            }

            if (!fs.existsSync(this.processPath)) {
                console.warn(
                    `[LocalERNIEAdapter] Python script not found at "${this.processPath}". ` +
                    'Intent classification will fall back to keyword matching only.'
                );
                this.started = false;
                resolve(); // 不阻塞主流程，后续请求会走 fallback
                return;
            }

            this.starting = true;

            try {
                // 尝试使用 python3，失败则回退到 python
                const pythonCmd = this._detectPython();

                console.log(`[LocalERNIEAdapter] Starting Python subprocess: ${pythonCmd} ${this.processPath}`);

                this.pythonProcess = spawn(pythonCmd, [this.processPath], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env },
                });

                this.rl = createInterface({
                    input: this.pythonProcess.stdout!,
                    crlfDelay: Infinity,
                });

                // 处理 stderr（打印为日志）
                this.pythonProcess.stderr!.on('data', (data: Buffer) => {
                    const msg = data.toString().trim();
                    if (msg) {
                        console.log(`[ERNIE] ${msg}`);
                    }
                });

                // 处理每行 stdout 响应
                this.rl.on('line', (line: string) => {
                    line = line.trim();
                    if (!line) return;

                    try {
                        const response = JSON.parse(line);
                        const reqId = response.id;
                        const pending = this.pendingRequests.get(reqId);

                        if (pending) {
                            clearTimeout(pending.timer);
                            this.pendingRequests.delete(reqId);
                            pending.resolve(response);
                        }
                    } catch {
                        // 非 JSON 行忽略（如初始化日志）
                    }
                });

                // 子进程退出处理
                this.pythonProcess.on('exit', (code, signal) => {
                    console.log(`[LocalERNIEAdapter] Python process exited (code: ${code}, signal: ${signal})`);
                    this.started = false;
                    this.starting = false;
                    this.pythonProcess = null;
                    this.rl = null;

                    // 拒绝所有待处理的请求
                    for (const [id, pending] of this.pendingRequests) {
                        clearTimeout(pending.timer);
                        pending.reject(new Error(`Python process exited with code ${code}`));
                    }
                    this.pendingRequests.clear();
                });

                this.pythonProcess.on('error', (err) => {
                    console.error(`[LocalERNIEAdapter] Python process error: ${err.message}`);
                    this.started = false;
                    this.starting = false;
                });

                // 等待初始化的"ready"信号（从 stderr 输出）
                // 没有严格等待，后续请求会排队，lazy load 会在首次请求时触发
                this.started = true;
                this.starting = false;
                console.log('[LocalERNIEAdapter] Python subprocess started (lazy model loading on first request).');
                resolve();

            } catch (err: any) {
                this.started = false;
                this.starting = false;
                console.error(`[LocalERNIEAdapter] Failed to start Python process: ${err.message}`);
                resolve(); // 不阻塞，后续请求走 fallback
            }
        });
    }

    /**
     * 检测系统中可用的 Python 命令
     */
    private _detectPython(): string {
        const candidates = ['python3', 'python'];
        for (const cmd of candidates) {
            try {
                const result = require('child_process').spawnSync(cmd, ['--version'], {
                    stdio: 'pipe',
                    encoding: 'utf-8',
                    timeout: 3000,
                });
                if (result.status === 0) {
                    return cmd;
                }
            } catch {
                continue;
            }
        }
        return 'python3'; // 默认
    }

    /**
     * 核心方法：对用户文本进行意图分类
     *
     * 先在本地做快速关键词匹配（零成本），
     * 若置信度不足，则交给 ERNIE-0.3B 小模型做深度分类。
     *
     * @param userInput 用户原始输入
     * @param localFallback 纯关键词匹配的结果（由 IntentRouter 提供）
     * @returns 意图分类结果
     */
    public async classifyIntent(
        userInput: string,
        localFallback?: IntentClassification
    ): Promise<IntentClassification> {
        // 1. 先做本地快速分类（零模型开销）
        const keywordResult = this._classifyByKeywords(userInput);

        // 如果关键词匹配置信度足够高（>= 0.3），直接返回，不劳烦小模型
        if (keywordResult.confidence >= 0.3) {
            return keywordResult;
        }

        // 2. 置信度不足时，尝试调用本地 ERNIE 小模型
        try {
            await this.ensureStarted();

            if (!this.started || !this.pythonProcess || !this.pythonProcess.stdin) {
                // 子进程未启动成功，返回关键词结果
                return keywordResult;
            }

            const result = await this._requestLLM(userInput);
            if (result && result.intent && result.confidence > 0) {
                console.log(
                    `[LocalERNIEAdapter] ERNIE-0.3B classified intent: "${result.intent}" (confidence: ${result.confidence.toFixed(2)})`
                );
                return {
                    intent: result.intent,
                    confidence: result.confidence,
                    reasoning: result.reasoning || 'classified by ERNIE-4.5-0.3B',
                };
            }

            return keywordResult;
        } catch (err: any) {
            console.warn(`[LocalERNIEAdapter] ERNIE classification failed: ${err.message}. Using keyword fallback.`);
            return keywordResult;
        }
    }

    /**
     * 向 Python 子进程发送分类请求
     */
    private _requestLLM(userInput: string): Promise<IntentClassification> {
        return new Promise((resolve, reject) => {
            if (!this.pythonProcess || !this.pythonProcess.stdin) {
                reject(new Error('Python process not available'));
                return;
            }

            const id = nextId();

            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`ERNIE classification request timed out after ${REQUEST_TIMEOUT_MS}ms`));
            }, REQUEST_TIMEOUT_MS);

            this.pendingRequests.set(id, {
                resolve: (response: any) => {
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve({
                            intent: response.intent || 'unknown',
                            confidence: response.confidence ?? 0,
                            reasoning: response.reasoning || '',
                        });
                    }
                },
                reject,
                timer,
            });

            const request = JSON.stringify({
                id,
                mode: 'classify',
                text: userInput,
            });

            this.pythonProcess.stdin.write(request + '\n');
        });
    }

    /**
     * 纯本地关键词分类（与 IntentRouter.classifyByKeywords 逻辑一致）
     * 作为零成本的快速路径
     */
    private _classifyByKeywords(userInput: string): IntentClassification {
        const lowerInput = userInput.toLowerCase();

        const rules: Array<{
            keywords: string[];
            intent: string;
        }> = [
            { keywords: ['重构', 'refactor', '修改', 'edit', '改一下', '替换', 'replace', '修复', 'fix', '优化'], intent: 'code_edit' },
            { keywords: ['搜索', 'search', '找到', 'find', 'grep', '定位', 'locate', '哪里'], intent: 'code_search' },
            { keywords: ['生成', 'generate', '创建', 'create', '新建', '新增', 'scaffold', '写一个'], intent: 'code_generate' },
            { keywords: ['报错', 'error', 'bug', '崩溃', 'crash', '调试', 'debug', '排查', '为什么'], intent: 'debug' },
            { keywords: ['解释', 'explain', '什么意思', '为何', '原理', '怎么工作', '是什么'], intent: 'explain' },
            { keywords: ['计划', 'plan', '拆解', '任务', '设计', '架构', 'design', 'architect'], intent: 'task_planning' },
            { keywords: ['爬虫', 'crawl', '新闻', 'news', '查询', 'query', '搜一下', '网上', '搜索一下'], intent: 'info_retrieval' },
        ];

        let bestIntent = 'general_chat';
        let bestScore = 0;

        for (const rule of rules) {
            const score = rule.keywords.filter(kw => lowerInput.includes(kw)).length;
            if (score > bestScore) {
                bestScore = score;
                bestIntent = rule.intent;
            }
        }

        const confidence = bestScore > 0 ? Math.min(bestScore * 0.25, 0.8) : 0.1;
        return {
            intent: bestIntent,
            confidence,
            reasoning: bestScore > 0
                ? `keyword_match: ${bestScore} hits`
                : 'no keyword match, default to general_chat',
        };
    }

    /**
     * 健康检查：查询 Python 子进程状态
     */
    public async healthCheck(): Promise<HealthStatus> {
        try {
            await this.ensureStarted();

            if (!this.started || !this.pythonProcess || !this.pythonProcess.stdin) {
                return {
                    loaded: false,
                    model: 'PaddlePaddle/ERNIE-4.5-0.3B-PT',
                    error: 'Python subprocess not available',
                    categories: [],
                };
            }

            const result = await this._request<HealthStatus>('health');
            return result;
        } catch {
            return {
                loaded: false,
                model: 'PaddlePaddle/ERNIE-4.5-0.3B-PT',
                error: 'Health check failed',
                categories: [],
            };
        }
    }

    /**
     * 通用请求方法
     */
    private _request<T>(mode: string, data?: Record<string, any>, customTimeout?: number): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.pythonProcess || !this.pythonProcess.stdin) {
                reject(new Error('Python process not available'));
                return;
            }

            const id = nextId();
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request "${mode}" timed out`));
            }, customTimeout ?? REQUEST_TIMEOUT_MS);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timer,
            });

            const request = JSON.stringify({ id, mode, ...data });
            this.pythonProcess.stdin.write(request + '\n');
        });
    }

    /**
     * 用本地模型生成文本回复（兜底生成模式）。
     * 当所有远程 API 都不可用时，由本地小模型直接回复用户。
     * 通过 "chat" 模式发送到 Python 子进程。
     */
    public async chat(userInput: string, maxTokens: number = 512): Promise<string> {
        try {
            await this.ensureStarted();

            if (!this.started || !this.pythonProcess || !this.pythonProcess.stdin) {
                return '[本地模型不可用]';
            }

            // chat 生成需要更长时间（CPU 推理）
            const result = await this._request<{ response: string; tokens: number }>('chat', {
                text: userInput,
                max_tokens: maxTokens,
            }, CHAT_TIMEOUT_MS);

            if (result && result.response) {
                return result.response;
            }
            return '[本地模型未生成回复]';
        } catch (err: any) {
            return `[本地模型回复出错: ${err.message}]`;
        }
    }

    /**
     * 实现 ILLMProvider.generateResponseStream
     *
     * 当本地小模型被用作兜底生成器时，通过此方法将回复流式返回。
     * 这是 ILLMProvider 接口的必要实现。
     */
    async generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        // 拼接用户消息
        const userMessages = prompt.messages
            .filter(m => m.role === 'user')
            .map(m => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');

        if (!userMessages) {
            onEvent({ type: 'error', data: 'No user message found' });
            onEvent({ type: 'done' });
            return;
        }

        const response = await this.chat(userMessages, 512);
        onEvent({ type: 'text', data: response });
        onEvent({ type: 'done' });
    }

    /**
     * 实现 ILLMProvider.supportsEmbedding
     * 本地 ERNIE 不支持 embedding
     */
    supportsEmbedding(): boolean {
        return false;
    }

    /**
     * Shutdown the Python child process
     */
    public shutdown(): void {
        if (this.pythonProcess) {
            try {
                this.pythonProcess.stdin?.write(JSON.stringify({ id: 'shutdown', mode: 'unload' }) + '\n');
                this.pythonProcess.kill('SIGTERM');

                // 5秒后强制杀死
                setTimeout(() => {
                    if (this.pythonProcess) {
                        this.pythonProcess.kill('SIGKILL');
                    }
                }, 5000);
            } catch {
                // 忽略关闭时的错误
            }
        }

        this.pythonProcess = null;
        this.rl = null;
        this.started = false;

        // 拒绝所有待处理请求
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Adapter shutting down'));
        }
        this.pendingRequests.clear();
    }
}

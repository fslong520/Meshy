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

// ─── 全局单例缓存（挂 global 而非模块级，tsx 热更新时不被重置） ───
// 不同 TaskEngine 实例复用同一 Python 子进程，避免重复加载模型
const GLOBAL_KEY = '__meshy_ernie_singleton__';
function getGlobalERNIE(): LocalERNIEAdapter | null {
    return (global as any)[GLOBAL_KEY]?.instance ?? null;
}
function setGlobalERNIE(instance: LocalERNIEAdapter | null): void {
    (global as any)[GLOBAL_KEY] = { instance, refCount: getRefCount() };
}
function getRefCount(): number {
    return (global as any)[GLOBAL_KEY]?.refCount ?? 0;
}
function incRefCount(): number {
    const ref = (global as any)[GLOBAL_KEY] ?? { instance: null, refCount: 0 };
    ref.refCount++;
    (global as any)[GLOBAL_KEY] = ref;
    return ref.refCount;
}
function decRefCount(): number {
    const ref = (global as any)[GLOBAL_KEY] ?? { instance: null, refCount: 0 };
    ref.refCount = Math.max(0, ref.refCount - 1);
    (global as any)[GLOBAL_KEY] = ref;
    return ref.refCount;
}

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

    private processPath: string = '';
    private started = false;
    private starting = false;

    /** 并发锁，防止同时发出多个启动请求 */
    private startPromise: Promise<void> | null = null;

    /**
     * 返回真正的全局实例（影子实例将所有调用委托给它）
     */
    private _delegate(): LocalERNIEAdapter {
        const g = getGlobalERNIE();
        return (this !== g && g) ? g : this;
    }

    constructor() {
        const existing = getGlobalERNIE();
        if (existing) {
            incRefCount();
            return;
        }

        setGlobalERNIE(this);
        incRefCount();

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
            resolvedPath = searchPaths[0];
        }

        this.processPath = resolvedPath;
    }

    /**
     * 启动 Python 子进程（首次请求时自动调用）
     */
    private async ensureStarted(): Promise<void> {
        const _ = this._delegate();
        if (_.started) return;
        if (_.startPromise) return _.startPromise;

        _.startPromise = _._startProcess();
        return _.startPromise;
    }

    private _startProcess(): Promise<void> {
        const _ = this._delegate();
        return new Promise((resolve, reject) => {
            if (_.started) {
                resolve();
                return;
            }

            if (!fs.existsSync(_.processPath)) {
                console.warn(
                    `[LocalERNIEAdapter] Python script not found at "${_.processPath}". ` +
                    'Intent classification will fall back to keyword matching only.'
                );
                _.started = false;
                resolve();
                return;
            }

            _.starting = true;

            try {
                const pythonCmd = _._detectPython();

                console.log(`[LocalERNIEAdapter] Starting Python subprocess: ${pythonCmd} ${_.processPath}`);

                _.pythonProcess = spawn(pythonCmd, [_.processPath], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env },
                });

                _.rl = createInterface({
                    input: _.pythonProcess.stdout!,
                    crlfDelay: Infinity,
                });

                _.pythonProcess.stderr!.on('data', (data: Buffer) => {
                    const msg = data.toString().trim();
                    if (msg) console.log(`[ERNIE] ${msg}`);
                });

                _.rl.on('line', (line: string) => {
                    line = line.trim();
                    if (!line) return;
                    try {
                        const response = JSON.parse(line);
                        const reqId = response.id;
                        const pending = _.pendingRequests.get(reqId);
                        if (pending) {
                            // 流式模式：done=false 表示还有后续 token，不清除 pending
                            if (response.done === false) {
                                pending.resolve(response);
                            } else {
                                clearTimeout(pending.timer);
                                _.pendingRequests.delete(reqId);
                                pending.resolve(response);
                            }
                        }
                    } catch { /* ignore non-JSON lines */ }
                });

                _.pythonProcess.on('exit', (code, signal) => {
                    console.log(`[LocalERNIEAdapter] Python process exited (code: ${code}, signal: ${signal})`);
                    _.started = false;
                    _.starting = false;
                    _.pythonProcess = null;
                    _.rl = null;
                    for (const [id, pending] of _.pendingRequests) {
                        clearTimeout(pending.timer);
                        pending.reject(new Error(`Python process exited with code ${code}`));
                    }
                    _.pendingRequests.clear();
                });

                _.pythonProcess.on('error', (err) => {
                    console.error(`[LocalERNIEAdapter] Python process error: ${err.message}`);
                    _.started = false;
                    _.starting = false;
                });

                _.started = true;
                _.starting = false;
                console.log('[LocalERNIEAdapter] Python subprocess started (lazy model loading on first request).');
                resolve();

            } catch (err: any) {
                _.started = false;
                _.starting = false;
                console.error(`[LocalERNIEAdapter] Failed to start Python process: ${err.message}`);
                resolve();
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
        const _ = this._delegate();
        const keywordResult = _._classifyByKeywords(userInput);

        if (keywordResult.confidence >= 0.3) {
            return keywordResult;
        }

        try {
            await _.ensureStarted();
            if (!_.started || !_.pythonProcess || !_.pythonProcess.stdin) {
                return keywordResult;
            }
            const result = await _._requestLLM(userInput);
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
        const _ = this._delegate();
        return new Promise((resolve, reject) => {
            if (!_.pythonProcess || !_.pythonProcess.stdin) {
                reject(new Error('Python process not available'));
                return;
            }
            const id = nextId();
            const timer = setTimeout(() => {
                _.pendingRequests.delete(id);
                reject(new Error(`ERNIE classification request timed out after ${REQUEST_TIMEOUT_MS}ms`));
            }, REQUEST_TIMEOUT_MS);
            _.pendingRequests.set(id, {
                resolve: (response: any) => {
                    if (response.error) reject(new Error(response.error));
                    else resolve({
                        intent: response.intent || 'unknown',
                        confidence: response.confidence ?? 0,
                        reasoning: response.reasoning || '',
                    });
                },
                reject,
                timer,
            });
            _.pythonProcess.stdin.write(JSON.stringify({ id, mode: 'classify', text: userInput }) + '\n');
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
        const _ = this._delegate();
        try {
            await _.ensureStarted();
            if (!_.started || !_.pythonProcess || !_.pythonProcess.stdin) {
                return { loaded: false, model: 'PaddlePaddle/ERNIE-4.5-0.3B-PT', error: 'Python subprocess not available', categories: [] };
            }
            return await _._request<HealthStatus>('health');
        } catch {
            return { loaded: false, model: 'PaddlePaddle/ERNIE-4.5-0.3B-PT', error: 'Health check failed', categories: [] };
        }
    }

    private _request<T>(mode: string, data?: Record<string, any>, customTimeout?: number): Promise<T> {
        const _ = this._delegate();
        return new Promise((resolve, reject) => {
            if (!_.pythonProcess || !_.pythonProcess.stdin) {
                reject(new Error('Python process not available'));
                return;
            }
            const id = nextId();
            const timer = setTimeout(() => {
                _.pendingRequests.delete(id);
                reject(new Error(`Request "${mode}" timed out`));
            }, customTimeout ?? REQUEST_TIMEOUT_MS);
            _.pendingRequests.set(id, { resolve, reject, timer });
            _.pythonProcess.stdin.write(JSON.stringify({ id, mode, ...data }) + '\n');
        });
    }

    public async chat(userInput: string, maxTokens: number = 512): Promise<string> {
        const _ = this._delegate();
        try {
            await _.ensureStarted();
            if (!_.started || !_.pythonProcess || !_.pythonProcess.stdin) return '[本地模型不可用]';
            const result = await _._request<{ response: string; tokens: number }>('chat', { text: userInput, max_tokens: maxTokens }, CHAT_TIMEOUT_MS);
            return result?.response ?? '[本地模型未生成回复]';
        } catch (err: any) {
            return `[本地模型回复出错: ${err.message}]`;
        }
    }

    /**
     * 实现 ILLMProvider.generateResponseStream
     *
     * 真流式：向 Python 发 stream_chat 请求，逐行读取 token 转发。
     */
    async generateResponseStream(
        prompt: StandardPrompt,
        onEvent: (event: AgentMessageEvent) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        const _ = this._delegate();
        const userMessages = prompt.messages
            .filter(m => m.role === 'user')
            .map(m => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');
        if (!userMessages) {
            onEvent({ type: 'error', data: 'No user message found' });
            onEvent({ type: 'done' });
            return;
        }

        await _.ensureStarted();
        if (!_.started || !_.pythonProcess || !_.pythonProcess.stdin) {
            onEvent({ type: 'text', data: '[本地模型不可用]', replace: true });
            onEvent({ type: 'done' });
            return;
        }

        const id = nextId();
        let fullClean = '';
        let resolvePromise: (() => void) | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const reader = (line: string) => {
            try {
                const resp = JSON.parse(line.trim());
                if (resp.id !== id) return;
                if (resp.done) {
                    if (timeoutId) clearTimeout(timeoutId);
                    _.rl?.removeListener('line', reader);
                    onEvent({ type: 'done' });
                    if (resolvePromise) resolvePromise();
                } else if (resp.text) {
                    fullClean += resp.text;
                    const clean = fullClean.replace(/<\/?s>/g, '').replace(/<\|endoftext\|>/g, '').replace(/<\|im_end\|>/g, '').replace(/<\|im_start\|>/g, '');
                    onEvent({ type: 'text', data: clean, replace: true });
                }
            } catch {}
        };

        _.rl?.on('line', reader);
        _.pythonProcess.stdin.write(JSON.stringify({ id, mode: 'stream_chat', text: userMessages, max_tokens: 512 }) + '\n');

        await new Promise<void>((resolve) => {
            resolvePromise = resolve;
            timeoutId = setTimeout(() => {
                _.rl?.removeListener('line', reader);
                onEvent({ type: 'done' });
                resolve();
            }, 60_000);
        });
    }

    /**
     * 实现 ILLMProvider.supportsEmbedding
     * 本地 ERNIE 不支持 embedding
     */
    supportsEmbedding(): boolean {
        return false;
    }

    /**
     * Shutdown the Python child process (引用计数归零时才真正关闭)
     */
    public shutdown(): void {
        const remaining = decRefCount();
        const g = getGlobalERNIE();
        if (this !== g) return;  // 影子实例，不负责关闭
        if (remaining > 0) return;  // 还有引用户，不关闭

        const _ = this._delegate();
        if (_.pythonProcess) {
            try {
                _.pythonProcess.stdin?.write(JSON.stringify({ id: 'shutdown', mode: 'unload' }) + '\n');
                _.pythonProcess.kill('SIGTERM');
                setTimeout(() => { if (_.pythonProcess) _.pythonProcess.kill('SIGKILL'); }, 5000);
            } catch { /* ignore */ }
        }

        _.pythonProcess = null;
        _.rl = null;
        _.started = false;

        for (const [id, pending] of _.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Adapter shutting down'));
        }
        _.pendingRequests.clear();

        setGlobalERNIE(null);
    }
}

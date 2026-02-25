/**
 * Terminal Manager - 隔离的多 PTY 终端管理器
 * 
 * 为 AI 提供执行 Shell 命令的虚拟终端能力：
 * 1. 支持启动多个隔离的终端会话
 * 2. 捕获实时输出，支持带限制的日志缓存（防止内存泄漏）
 * 3. 跨平台兼容（Windows powershell，Unix bash/zsh）
 * 
 * 引入 pty 而非普通 child_process 的原因：
 * 保证颜色代码、交互式提示符的正确渲染和交互，是最真实的终端模拟。
 */

import * as pty from 'node-pty';
import * as os from 'os';
import { randomUUID } from 'crypto';

export interface TerminalOutput {
    stdout: string;
}

export interface TerminalInfo {
    id: string;
    isActive: boolean;
    recentOutput: string;
}

export class TerminalSession {
    public readonly id: string;
    private ptyProcess: pty.IPty;
    private outputBuffer: string[] = [];
    private maxBufferSize: number = 2000; // 最多保留最后 2000 个输出块
    public isActive: boolean = true;

    constructor(cwd: string) {
        this.id = randomUUID();
        const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');

        this.ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 120,
            rows: 30,
            cwd: cwd,
            env: process.env as { [key: string]: string }
        });

        this.ptyProcess.onData((data) => {
            this.outputBuffer.push(data);
            if (this.outputBuffer.length > this.maxBufferSize) {
                this.outputBuffer.shift();
            }
        });

        this.ptyProcess.onExit(() => {
            this.isActive = false;
        });
    }

    /** 向终端发送命令 */
    public sendCommand(command: string): void {
        if (!this.isActive) {
            throw new Error(`Terminal ${this.id} is already closed.`);
        }
        this.ptyProcess.write(`${command}\r`);
    }

    /** 写入特定输入（如回车、Ctrl+C等） */
    public write(data: string): void {
        if (this.isActive) {
            this.ptyProcess.write(data);
        }
    }

    /** 获取终端自启动以来的所有缓存输出 */
    public getOutput(): string {
        return this.outputBuffer.join('');
    }

    /** 获取自某次读取后的增量输出（此处简化为清空缓冲区或者仅获取最新）
     * 实际实现中可以通过保存游标进行更精确的增量读取
     */
    public fetchRecentAndClear(): string {
        const out = this.getOutput();
        this.outputBuffer = []; // 清空，便于实现类似 stream 的读取
        return out;
    }

    /** 强制关闭终端 */
    public kill(): void {
        if (this.isActive) {
            this.ptyProcess.kill();
            this.isActive = false;
        }
    }
}

export class TerminalManager {
    private sessions: Map<string, TerminalSession> = new Map();
    private workspaceRoot: string;

    constructor(workspaceRoot: string = process.cwd()) {
        this.workspaceRoot = workspaceRoot;
    }

    /** 创建一个新的终端会话 */
    public createTerminal(): string {
        const session = new TerminalSession(this.workspaceRoot);
        this.sessions.set(session.id, session);
        return session.id;
    }

    /** 获取终端会话 */
    public getTerminal(id: string): TerminalSession | undefined {
        return this.sessions.get(id);
    }

    /** 列出所有活动的终端 */
    public listTerminals(): TerminalInfo[] {
        return Array.from(this.sessions.values()).map(s => ({
            id: s.id,
            isActive: s.isActive,
            // 简单截取最后 500 个字符用于预览
            recentOutput: s.getOutput().slice(-500)
        }));
    }

    /** 在新的默认终端中直接执行一条命令并等待几秒取回结果（阻塞式快捷方法）*/
    public async executeCommand(command: string, timeoutMs: number = 5000): Promise<string> {
        const tid = this.createTerminal();
        const term = this.getTerminal(tid)!;

        term.sendCommand(command);

        // 简单延迟等待命令执行结果，真实情况应该根据提示符正则等待
        await new Promise(resolve => setTimeout(resolve, timeoutMs));

        const output = term.getOutput();
        term.kill();
        this.sessions.delete(tid);

        return output;
    }

    /** 关闭所有终端 */
    public disposeAll(): void {
        for (const session of this.sessions.values()) {
            session.kill();
        }
        this.sessions.clear();
    }
}

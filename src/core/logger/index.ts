/**
 * Structured Logger — 分级分通道的结构化日志系统
 *
 * 支持通道（LLM / ACI / LSP / ENGINE / SESSION / TOOL）和
 * 日志级别（DEBUG / INFO / WARN / ERROR）。
 * Dev 模式下同时输出到 console 和 .meshy/logs/<sessionId>.jsonl。
 */

import fs from 'fs';
import path from 'path';

// ─── 日志级别 ───
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

// ─── 日志通道 ───
export type LogChannel = 'LLM' | 'ACI' | 'LSP' | 'ENGINE' | 'SESSION' | 'TOOL' | 'WORKFLOW';

// ─── 日志条目 ───
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    channel: LogChannel;
    message: string;
    data?: Record<string, unknown>;
}

// ─── ANSI 颜色 ───
const COLORS: Record<LogLevel, string> = {
    DEBUG: '\x1b[90m',   // gray
    INFO: '\x1b[36m',    // cyan
    WARN: '\x1b[33m',    // yellow
    ERROR: '\x1b[31m',   // red
};
const RESET = '\x1b[0m';

export class Logger {
    private minLevel: LogLevel;
    private logDir: string | null = null;
    private logStream: fs.WriteStream | null = null;
    private consoleEnabled: boolean;

    constructor(options: {
        minLevel?: LogLevel;
        workspaceRoot?: string;
        sessionId?: string;
        consoleEnabled?: boolean;
    } = {}) {
        this.minLevel = options.minLevel ?? 'INFO';
        this.consoleEnabled = options.consoleEnabled ?? true;

        if (options.workspaceRoot) {
            this.initFileOutput(options.workspaceRoot, options.sessionId);
        }
    }

    /** 初始化文件输出流 */
    private initFileOutput(workspaceRoot: string, sessionId?: string): void {
        this.logDir = path.join(workspaceRoot, '.meshy', 'logs');
        try {
            fs.mkdirSync(this.logDir, { recursive: true });
            const filename = sessionId
                ? `${sessionId}.jsonl`
                : `session-${Date.now()}.jsonl`;
            this.logStream = fs.createWriteStream(
                path.join(this.logDir, filename),
                { flags: 'a' },
            );
        } catch {
            // 静默失败：日志目录不可写时不影响主流程
        }
    }

    /** 核心写入方法 */
    private write(level: LogLevel, channel: LogChannel, message: string, data?: Record<string, unknown>): void {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            channel,
            message,
            ...(data !== undefined ? { data } : {}),
        };

        // Console 输出（彩色）
        if (this.consoleEnabled) {
            const color = COLORS[level];
            const prefix = `${color}[${level}][${channel}]${RESET}`;
            console.log(`${prefix} ${message}`);
        }

        // JSONL 文件输出
        if (this.logStream) {
            this.logStream.write(JSON.stringify(entry) + '\n');
        }
    }

    // ─── 按通道的便捷方法 ───

    llm(message: string, data?: Record<string, unknown>): void {
        this.write('INFO', 'LLM', message, data);
    }

    aci(message: string, data?: Record<string, unknown>): void {
        this.write('INFO', 'ACI', message, data);
    }

    lsp(message: string, data?: Record<string, unknown>): void {
        this.write('INFO', 'LSP', message, data);
    }

    engine(message: string, data?: Record<string, unknown>): void {
        this.write('INFO', 'ENGINE', message, data);
    }

    session(message: string, data?: Record<string, unknown>): void {
        this.write('INFO', 'SESSION', message, data);
    }

    tool(message: string, data?: Record<string, unknown>): void {
        this.write('INFO', 'TOOL', message, data);
    }

    workflow(message: string, data?: Record<string, unknown>): void {
        this.write('INFO', 'WORKFLOW', message, data);
    }

    // ─── 按级别的通用方法 ───

    debug(channel: LogChannel, message: string, data?: Record<string, unknown>): void {
        this.write('DEBUG', channel, message, data);
    }

    info(channel: LogChannel, message: string, data?: Record<string, unknown>): void {
        this.write('INFO', channel, message, data);
    }

    warn(channel: LogChannel, message: string, data?: Record<string, unknown>): void {
        this.write('WARN', channel, message, data);
    }

    error(channel: LogChannel, message: string, data?: Record<string, unknown>): void {
        this.write('ERROR', channel, message, data);
    }

    /** 关闭日志流 */
    close(): void {
        this.logStream?.end();
        this.logStream = null;
    }
}

// ─── 全局默认实例（延迟初始化） ───
let _globalLogger: Logger | null = null;

export function getLogger(): Logger {
    if (!_globalLogger) {
        _globalLogger = new Logger();
    }
    return _globalLogger;
}

export function initLogger(options: ConstructorParameters<typeof Logger>[0]): Logger {
    _globalLogger?.close();
    _globalLogger = new Logger(options);
    return _globalLogger;
}

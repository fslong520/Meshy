import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import EventEmitter from 'events';

export interface TerminalOutput {
    type: 'stdout' | 'stderr' | 'error';
    data: string;
    timestamp: number;
}

export interface TerminalProcess {
    id: string;
    command: string;
    cwd: string;
    startedAt: string;
    process: ChildProcess;
    outputBuffer: TerminalOutput[];
    status: 'running' | 'exited' | 'killed';
    exitCode: number | null;
}

const MAX_OUTPUT_BUFFER = 50_000; // ~50KB per terminal to prevent OOM
const MAX_LOG_HISTORY = 1000;     // Max messages in buffer

export class TerminalManager extends EventEmitter {
    private processes: Map<string, TerminalProcess> = new Map();

    /**
     * Non-blocking start of a command
     */
    public startProcess(command: string, cwd: string, existingId?: string): string {
        const id = existingId || randomUUID();
        const startedAt = new Date().toISOString();

        // 自动判定 Shell
        const shell = process.platform === 'win32' ? 'powershell.exe' : true;

        const child = spawn(command, {
            shell,
            cwd,
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const termProcess: TerminalProcess = {
            id,
            command,
            cwd,
            startedAt,
            process: child,
            outputBuffer: [],
            status: 'running',
            exitCode: null
        };

        this.processes.set(id, termProcess);

        const appendLog = (type: 'stdout' | 'stderr' | 'error', data: string) => {
            termProcess.outputBuffer.push({ type, data, timestamp: Date.now() });

            // Limit buffer size to prevent memory leaks from long-running dev servers
            if (termProcess.outputBuffer.length > MAX_LOG_HISTORY) {
                termProcess.outputBuffer.shift();
            }

            // Cap total string length as well if a single chunk is massive
            const lastData = termProcess.outputBuffer[termProcess.outputBuffer.length - 1];
            if (lastData.data.length > MAX_OUTPUT_BUFFER) {
                lastData.data = lastData.data.slice(lastData.data.length - MAX_OUTPUT_BUFFER);
            }
        };

        child.stdout?.on('data', (chunk: Buffer) => appendLog('stdout', chunk.toString()));
        child.stderr?.on('data', (chunk: Buffer) => appendLog('stderr', chunk.toString()));

        child.on('error', (err) => {
            appendLog('error', err.message);
            termProcess.status = 'exited';
            termProcess.exitCode = -1;
            this.emit('process:error', id, err);
        });

        child.on('exit', (code) => {
            appendLog('stdout', `\n[Process exited with code ${code}]\n`);
            termProcess.status = 'exited';
            termProcess.exitCode = code;
            this.emit('process:exit', id, code);
        });

        return id;
    }

    /**
     * Send string to stdin of a running process
     */
    public sendInput(id: string, input: string): boolean {
        const proc = this.processes.get(id);
        if (!proc || proc.status !== 'running' || !proc.process.stdin) {
            return false;
        }
        proc.process.stdin.write(input);
        return true;
    }

    /**
     * Fetch recent raw output from the terminal
     */
    public getProcessOutput(id: string, maxChars: number = 10000): string {
        const proc = this.processes.get(id);
        if (!proc) {
            return `Error: Terminal ID ${id} is not found or has been purged.`;
        }

        let combined = proc.outputBuffer.map(o => o.data).join('');

        if (combined.length > maxChars) {
            combined = '...(output truncated)...\n' + combined.slice(combined.length - maxChars);
        }

        return combined;
    }

    /**
     * Get process state
     */
    public getProcessStatus(id: string) {
        const proc = this.processes.get(id);
        if (!proc) return null;

        return {
            id: proc.id,
            command: proc.command,
            cwd: proc.cwd,
            status: proc.status,
            exitCode: proc.exitCode,
            startedAt: proc.startedAt
        };
    }

    public killProcess(id: string): boolean {
        const proc = this.processes.get(id);
        if (!proc || proc.status !== 'running') {
            return false;
        }
        proc.status = 'killed';
        proc.process.kill('SIGTERM');
        setTimeout(() => {
            if (proc.process && !proc.process.killed) {
                proc.process.kill('SIGKILL');
            }
        }, 1000);
        return true;
    }

    /**
     * Checks if a process ID claims to be running, but the actual child process has detached/died
     */
    public validateProcessActiveness(id: string): boolean {
        const proc = this.processes.get(id);
        if (!proc) return false;

        // If it's already marked exited, it's validly tracked but dead
        if (proc.status !== 'running') return false;

        // If stdin is destroyed or process is killed, it's dead but hasn't received exit event yet
        if (proc.process.killed || (proc.process.stdin && proc.process.stdin.destroyed)) {
            proc.status = 'exited';
            return false;
        }

        return true;
    }

    public listProcesses() {
        return Array.from(this.processes.values()).map(p => ({
            id: p.id,
            command: p.command,
            status: p.status
        }));
    }
}

// Global Singleton
export const terminalManager = new TerminalManager();

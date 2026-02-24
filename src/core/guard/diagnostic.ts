/**
 * LSP Diagnostic Guard — 代码诊断拦截器
 *
 * 职责：
 * 1. 在 Agent 修改代码写入磁盘前，先写入虚拟草稿层
 * 2. 调用本地 LSP/编译器进行诊断
 * 3. 如果存在致命错误（Error 级别），阻止写入并返回诊断信息让 LLM 自我修正
 * 4. 如果只有 Warning 或无错误，放行写入
 *
 * 当前 MVP 实现：
 * - 使用 `tsc --noEmit` 对 TypeScript 文件进行类型检查
 * - 未来可扩展对接真正的 LSP Server（通过 JSON-RPC）
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── 诊断严重程度 ───
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

// ─── 单条诊断信息 ───
export interface Diagnostic {
    file: string;
    line: number;
    column: number;
    severity: DiagnosticSeverity;
    message: string;
    code?: string;
}

// ─── 诊断结果 ───
export interface DiagnosticResult {
    passed: boolean;
    errorCount: number;
    warningCount: number;
    diagnostics: Diagnostic[];
}

// ─── 支持诊断的文件扩展名 → 检查器映射 ───
const SUPPORTED_CHECKERS: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
};

/**
 * 解析 tsc 的标准错误输出为结构化诊断列表。
 * 典型格式: src/foo.ts(10,5): error TS2322: Type 'X' is not assignable to type 'Y'.
 */
function parseTscOutput(output: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(output)) !== null) {
        diagnostics.push({
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            severity: match[4] as DiagnosticSeverity,
            code: match[5],
            message: match[6],
        });
    }

    return diagnostics;
}

export class DiagnosticGuard {
    private workspaceRoot: string;

    constructor(workspaceRoot: string = process.cwd()) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * 对指定文件内容进行诊断检查（不写入磁盘）。
     * 通过创建临时文件 → 运行 tsc → 解析输出 → 清理临时文件。
     */
    public checkContent(filePath: string, content: string): DiagnosticResult {
        const ext = path.extname(filePath);
        const checker = SUPPORTED_CHECKERS[ext];

        if (!checker) {
            // 不支持诊断的文件类型，直接放行
            return { passed: true, errorCount: 0, warningCount: 0, diagnostics: [] };
        }

        if (checker === 'typescript') {
            return this.runTypeScriptCheck(filePath, content);
        }

        return { passed: true, errorCount: 0, warningCount: 0, diagnostics: [] };
    }

    /**
     * 对当前工作区进行全量 TypeScript 诊断。
     */
    public checkWorkspace(): DiagnosticResult {
        return this.runTsc();
    }

    // ─── TypeScript 单文件检查 ───
    private runTypeScriptCheck(_filePath: string, content: string): DiagnosticResult {
        // 写入临时文件进行检查
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshy-lint-'));
        const tmpFile = path.join(tmpDir, 'check.ts');

        try {
            fs.writeFileSync(tmpFile, content, 'utf8');

            const output = this.execTsc(`--noEmit --strict --skipLibCheck "${tmpFile}"`);
            const diagnostics = parseTscOutput(output);

            const errorCount = diagnostics.filter(d => d.severity === 'error').length;
            const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

            return {
                passed: errorCount === 0,
                errorCount,
                warningCount,
                diagnostics,
            };
        } finally {
            // 清理临时文件
            try {
                fs.unlinkSync(tmpFile);
                fs.rmdirSync(tmpDir);
            } catch { /* ignore cleanup errors */ }
        }
    }

    // ─── 整个工作区 tsc 检查 ───
    private runTsc(extraArgs: string = ''): DiagnosticResult {
        const output = this.execTsc(`--noEmit ${extraArgs}`);
        const diagnostics = parseTscOutput(output);

        const errorCount = diagnostics.filter(d => d.severity === 'error').length;
        const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

        return {
            passed: errorCount === 0,
            errorCount,
            warningCount,
            diagnostics,
        };
    }

    private execTsc(args: string): string {
        try {
            execSync(`npx tsc ${args}`, {
                cwd: this.workspaceRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 30000,
            });
            return ''; // 无错误
        } catch (err: unknown) {
            // tsc 在存在错误时会以非 0 退出码退出
            if (err && typeof err === 'object' && 'stdout' in err) {
                return (err as { stdout: string }).stdout || '';
            }
            return '';
        }
    }
}

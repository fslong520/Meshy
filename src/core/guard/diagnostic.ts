import * as ts from 'typescript';
import path from 'path';
import fs from 'fs';

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

/**
 * LSP Diagnostic Guard — 代码诊断拦截器
 * 使用 TypeScript Compiler API 在内存中验证修改后的代码，
 * 避免写入磁盘造成热更新循环或竞争，速度更快且无需独立启动进程。
 */
export class DiagnosticGuard {
    private workspaceRoot: string;
    private parsedCommandLine: ts.ParsedCommandLine | null = null;
    private tsconfigPath: string | undefined;

    constructor(workspaceRoot: string = process.cwd()) {
        this.workspaceRoot = workspaceRoot;
        this.tsconfigPath = ts.findConfigFile(workspaceRoot, ts.sys.fileExists, 'tsconfig.json');

        if (this.tsconfigPath) {
            const configFile = ts.readConfigFile(this.tsconfigPath, ts.sys.readFile);
            this.parsedCommandLine = ts.parseJsonConfigFileContent(
                configFile.config,
                ts.sys,
                path.dirname(this.tsconfigPath)
            );
        }
    }

    /**
     * 在内存中对指定文件的新内容进行语法和语义诊断（模拟 LSP 行为）。
     */
    public checkContent(filePath: string, newContent: string): DiagnosticResult {
        const ext = path.extname(filePath);
        if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            return { passed: true, errorCount: 0, warningCount: 0, diagnostics: [] };
        }

        const absolutePath = path.resolve(this.workspaceRoot, filePath);

        // 如果找不到 tsconfig，退回到仅做简单语法检查，不报错缺少模块
        const options = this.parsedCommandLine?.options || { allowJs: true, checkJs: false, noEmit: true };

        // 创建自定义 CompilerHost，拦截目标文件的读取行为，返回在内存中的 newContent
        const host = ts.createCompilerHost(options);
        const originalReadFile = host.readFile.bind(host);

        host.readFile = (fileName: string) => {
            if (path.resolve(fileName) === absolutePath) {
                return newContent;
            }
            return originalReadFile(fileName);
        };

        // 获取原有的文件列表，如果没有 parsedCommandLine，至少包含当前检查的文件
        const rootNames = this.parsedCommandLine?.fileNames.includes(absolutePath)
            ? this.parsedCommandLine.fileNames
            : [...(this.parsedCommandLine?.fileNames || []), absolutePath];

        const program = ts.createProgram(rootNames, options, host);
        const sourceFile = program.getSourceFile(absolutePath);

        if (!sourceFile) {
            return { passed: true, errorCount: 0, warningCount: 0, diagnostics: [] };
        }

        // 收集语法级别和语义级别的诊断
        const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile);
        const semanticDiagnostics = program.getSemanticDiagnostics(sourceFile);
        const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];

        const formattedDiagnostics: Diagnostic[] = [];
        let errorCount = 0;
        let warningCount = 0;

        for (const diag of allDiagnostics) {
            if (diag.file) {
                const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start!);
                const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');

                let severity: DiagnosticSeverity = 'error';
                if (diag.category === ts.DiagnosticCategory.Warning) {
                    severity = 'warning';
                    warningCount++;
                } else if (diag.category === ts.DiagnosticCategory.Message || diag.category === ts.DiagnosticCategory.Suggestion) {
                    severity = 'info';
                } else {
                    errorCount++;
                }

                formattedDiagnostics.push({
                    file: path.relative(this.workspaceRoot, diag.file.fileName),
                    line: line + 1,
                    column: character + 1,
                    severity,
                    message,
                    code: `TS${diag.code}`
                });
            }
        }

        return {
            passed: errorCount === 0,
            errorCount,
            warningCount,
            diagnostics: formattedDiagnostics
        };
    }
}

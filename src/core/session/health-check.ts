import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { Session } from './state.js';

const execAsync = promisify(exec);

export interface HealthCheckResult {
    isHealthy: boolean;
    issues: string[];
    recommendation?: string;
}

/**
 * SessionHealthInspector
 * 
 * "Entropy Management" for long-running agents.
 * Runs lightweight diagnostic checks (Git status, TS compilation) at the 
 * start of a new session to prevent the agent from building on a broken foundation.
 */
export class SessionHealthInspector {
    private workspaceRoot: string;

    constructor(workspaceRoot: string = process.cwd()) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Run all health checks. Should be called only when a session is new (history.length <= 1).
     */
    public async inspectEnvironment(session: Session): Promise<HealthCheckResult> {
        const issues: string[] = [];

        // 1. Check Git state (are there massive uncommitted changes?)
        try {
            const { stdout: gitStatus } = await execAsync('git status --porcelain', { cwd: this.workspaceRoot });
            const dirtyFiles = gitStatus.split('\n').filter(Boolean);
            if (dirtyFiles.length > 20) {
                issues.push(`Git working tree is highly dirty (${dirtyFiles.length} changed files). This might cause context confusion.`);
            }
        } catch (e) {
            // Ignore if not a git repo
        }

        // 2. Check TypeScript baseline health
        try {
            // Run a fast typecheck without emitting files
            // Timeout of 8s to prevent blocking the startup for too long
            const { stdout } = await execAsync('npx tsc --noEmit', { 
                cwd: this.workspaceRoot,
                timeout: 8000 
            });
            // If it succeeds with 0 exit code, it's perfect.
        } catch (e: any) {
            // tsc exits with non-zero if there are type errors
            if (e.stdout) {
                const errorLines = e.stdout.split('\n').filter((l: string) => l.includes('error TS'));
                const errorCount = errorLines.length;
                if (errorCount > 0) {
                    issues.push(`TypeScript compilation failed with ${errorCount} error(s). E.g: ${errorLines[0].trim()}`);
                }
            } else if (e.killed) {
                // Timeout
                issues.push(`TypeScript type-check timed out, environment might be excessively large.}`);
            }
        }

        const isHealthy = issues.length === 0;
        let recommendation;

        if (!isHealthy) {
            recommendation = `System Health Warning: Detected ${issues.length} potential environment issue(s). ` +
                `Do you want me to prioritize fixing these before starting your requested task? ` +
                `\n- ` + issues.join('\n- ');
        }

        return {
            isHealthy,
            issues,
            recommendation
        };
    }
}

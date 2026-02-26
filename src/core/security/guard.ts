/**
 * SecurityGuard — Tool Execution Interceptor (ACL)
 *
 * Evaluates every tool call against the active ExecutionMode
 * before permitting execution. Implements whitelist/blacklist
 * classification for SMART mode and full blocking for restricted modes.
 */

import { ExecutionMode } from './modes.js';

// ─── Risk Classification ───

export enum RiskLevel {
    /** Safe read-only operations, always allowed */
    SAFE = 'safe',
    /** Potentially destructive, requires review in non-YOLO modes */
    RISKY = 'risky',
    /** Extremely dangerous, blocked in all modes except YOLO */
    DANGEROUS = 'dangerous',
}

export interface GuardDecision {
    allowed: boolean;
    reason: string;
    requiresApproval: boolean;
}

// ─── Pattern Lists ───

/** Tools that are always safe to execute (read-only) */
const SAFE_TOOLS = new Set(['readFile', 'glob', 'grep', 'ls', 'readBlackboard']);

/** Tools that modify the file system but are core editing tools */
const EDIT_TOOLS = new Set(['writeFile', 'editFile', 'write', 'writeBlackboard']);

/** Tools that can execute arbitrary code on the host system */
const EXEC_TOOLS = new Set(['bash', 'terminal']);

/** Dangerous shell command patterns (regex) */
const DANGEROUS_COMMAND_PATTERNS = [
    /\brm\s+(-rf?|--recursive)\b/i,
    /\brmdir\b/i,
    /\bdel\s+\/[sfq]/i,           // Windows del /s /f /q
    /\bformat\b/i,
    /\bdrop\s+table\b/i,
    /\bdrop\s+database\b/i,
    /\btruncate\s+table\b/i,
    /\bnpm\s+publish\b/i,
    /\bgit\s+push\s+.*--force\b/i,
    /\bcurl\b.*\|\s*(ba)?sh\b/i,   // Piping curl to shell
    /\bchmod\s+777\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
];

/** Safe shell command patterns that never need approval */
const SAFE_COMMAND_PATTERNS = [
    /^\s*ls\b/,
    /^\s*dir\b/i,
    /^\s*cat\b/,
    /^\s*type\b/i,
    /^\s*echo\b/,
    /^\s*pwd\b/,
    /^\s*git\s+(status|log|diff|branch|show)\b/,
    /^\s*node\s+--version\b/,
    /^\s*npm\s+(ls|list|outdated|info|view)\b/,
    /^\s*head\b/,
    /^\s*tail\b/,
    /^\s*wc\b/,
    /^\s*find\b/,
    /^\s*grep\b/,
    /^\s*which\b/,
    /^\s*where\b/i,
    /^\s*Get-Content\b/i,
    /^\s*Get-ChildItem\b/i,
    /^\s*Get-Location\b/i,
];

export class SecurityGuard {
    private mode: ExecutionMode;
    private pendingApprovalResolver: ((approved: boolean) => void) | null = null;

    constructor(mode: ExecutionMode) {
        this.mode = mode;
    }

    public setMode(mode: ExecutionMode): void {
        this.mode = mode;
    }

    public getMode(): ExecutionMode {
        return this.mode;
    }

    /**
     * Core evaluation: Should this tool call be allowed?
     */
    public evaluate(toolName: string, args: Record<string, any>): GuardDecision {
        switch (this.mode) {
            case ExecutionMode.YOLO:
                return { allowed: true, reason: 'YOLO mode: all actions permitted.', requiresApproval: false };

            case ExecutionMode.ACCEPT_EDITS:
                return this.evaluateAcceptEditsMode(toolName);

            case ExecutionMode.DEFAULT:
                return this.evaluateDefaultMode(toolName);

            case ExecutionMode.SMART:
                return this.evaluateSmartMode(toolName, args);

            case ExecutionMode.PLAN:
                // Plan mode acts like DEFAULT for now (requires approval for all writes/execs)
                return this.evaluateDefaultMode(toolName);

            default:
                return { allowed: false, reason: `Unknown execution mode: ${this.mode}`, requiresApproval: false };
        }
    }

    /**
     * Resolve a pending approval request (called by Daemon/UI layer).
     */
    public resolveApproval(approved: boolean): void {
        if (this.pendingApprovalResolver) {
            this.pendingApprovalResolver(approved);
            this.pendingApprovalResolver = null;
        }
    }

    /**
     * Wait for user approval. Returns a promise that resolves when the user responds.
     */
    public waitForApproval(): Promise<boolean> {
        return new Promise((resolve) => {
            this.pendingApprovalResolver = resolve;
        });
    }

    // ─── Private Mode Evaluators ───

    private evaluateAcceptEditsMode(toolName: string): GuardDecision {
        if (SAFE_TOOLS.has(toolName)) {
            return { allowed: true, reason: 'Read-only tool allowed.', requiresApproval: false };
        }
        if (EDIT_TOOLS.has(toolName)) {
            return { allowed: true, reason: 'Edit tool allowed in ACCEPT_EDITS mode.', requiresApproval: false };
        }
        // Block everything else (bash, terminal, etc.)
        return {
            allowed: false,
            reason: `Tool "${toolName}" is blocked in ACCEPT_EDITS mode. Only file edits are permitted.`,
            requiresApproval: false,
        };
    }

    private evaluateDefaultMode(toolName: string): GuardDecision {
        if (SAFE_TOOLS.has(toolName)) {
            return { allowed: true, reason: 'Read-only tool auto-approved.', requiresApproval: false };
        }
        // Everything else needs approval
        return {
            allowed: false,
            reason: `Tool "${toolName}" requires user approval in DEFAULT mode.`,
            requiresApproval: true,
        };
    }

    private evaluateSmartMode(toolName: string, args: Record<string, any>): GuardDecision {
        // Tier 1: Always allow safe tools
        if (SAFE_TOOLS.has(toolName)) {
            return { allowed: true, reason: 'Safe tool auto-approved.', requiresApproval: false };
        }

        // Tier 2: Allow edits but flag for awareness
        if (EDIT_TOOLS.has(toolName)) {
            return { allowed: true, reason: 'Edit tool auto-approved in SMART mode.', requiresApproval: false };
        }

        // Tier 3: Shell commands need deeper inspection
        if (EXEC_TOOLS.has(toolName)) {
            return this.classifyShellCommand(args.command || '');
        }

        // Unknown tools default to requiring approval
        return {
            allowed: false,
            reason: `Unknown tool "${toolName}" requires approval.`,
            requiresApproval: true,
        };
    }

    private classifyShellCommand(command: string): GuardDecision {
        // Check dangerous patterns first
        for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
            if (pattern.test(command)) {
                return {
                    allowed: false,
                    reason: `Command blocked: matches dangerous pattern "${pattern.source}". Command: "${command}"`,
                    requiresApproval: false, // Outright blocked, no approval possible
                };
            }
        }

        // Check safe patterns
        for (const pattern of SAFE_COMMAND_PATTERNS) {
            if (pattern.test(command)) {
                return {
                    allowed: true,
                    reason: 'Shell command matches safe pattern.',
                    requiresApproval: false,
                };
            }
        }

        // Gray area: requires human approval
        return {
            allowed: false,
            reason: `Shell command requires approval in SMART mode: "${command}"`,
            requiresApproval: true,
        };
    }
}

/**
 * Execution Sandbox — 5 级安全沙盒模式与 AskUser 阻断机制
 *
 * 5 个级别：
 * - YOLO:         全自动，无人类拦截（仅限远端沙盒）
 * - SMART:        三级智能审批（白名单直通 / 黑名单阻断 / AI 二次审阅）
 * - DEFAULT:      所有写操作需人类确认
 * - PLAN:         Agent 必须先提交 Plan，批准后才能执行
 * - ACCEPT_EDITS: 仅允许编辑现有文件，禁止新建文件和执行命令
 */

// ─── 执行模式枚举 ───
export type ExecutionMode = 'yolo' | 'smart' | 'default' | 'plan' | 'accept_edits';

import { PermissionNext, PermissionAction } from './permission.js';

// ─── 操作风险等级 ───
export type RiskLevel = 'safe' | 'moderate' | 'dangerous';

// ─── 操作类型 ───
export type ActionType = 'read_file' | 'edit_file' | 'write_file' | 'run_command' | 'delete_file' | 'web_request';

// ─── 审批结果 ───
export interface ApprovalResult {
    approved: boolean;
    reason?: string;
}

// ─── AskUser 回调签名 ───
export type AskUserCallback = (question: string, context?: string) => Promise<string>;

// ─── 白名单：绝对安全的操作 ───
const WHITELIST_PATTERNS: Record<ActionType, RegExp[]> = {
    read_file: [/.*/],  // 所有读操作都安全
    edit_file: [],
    write_file: [],
    run_command: [
        /^git\s+(status|log|diff|branch)/,
        /^ls\b/,
        /^dir\b/,
        /^cat\b/,
        /^type\b/,
        /^echo\b/,
        /^pwd\b/,
        /^cd\b/,
        /^node\s+--version/,
        /^npm\s+(list|ls|outdated|audit)/,
        /^npx\s+tsc\s+--noEmit/,
    ],
    delete_file: [],
    web_request: [],
};

// ─── 黑名单：绝对危险的操作，必须拦截 ───
const BLACKLIST_PATTERNS: Record<ActionType, RegExp[]> = {
    read_file: [],
    edit_file: [],
    write_file: [],
    run_command: [
        /rm\s+(-rf|--recursive)/i,
        /rmdir\s+\/s/i,
        /del\s+\/[sfq]/i,
        /DROP\s+(TABLE|DATABASE)/i,
        /TRUNCATE\s+TABLE/i,
        /format\s+[a-z]:/i,
        /mkfs/i,
        /dd\s+if=/i,
        />\s*\/dev\/(sda|hda|nvme)/,
        /shutdown/i,
        /reboot/i,
    ],
    delete_file: [/.*/], // 所有删除默认危险
    web_request: [],
};

/**
 * 判定某个操作的风险等级。
 */
function classifyRisk(actionType: ActionType, detail: string): RiskLevel {
    // 检查黑名单
    const blackPatterns = BLACKLIST_PATTERNS[actionType] || [];
    for (const pat of blackPatterns) {
        if (pat.test(detail)) return 'dangerous';
    }

    // 检查白名单
    const whitePatterns = WHITELIST_PATTERNS[actionType] || [];
    for (const pat of whitePatterns) {
        if (pat.test(detail)) return 'safe';
    }

    return 'moderate';
}

import { AISecondaryReviewer } from './reviewer.js';

/**
 * ExecutionSandbox — 安全沙盒控制器
 *
 * 所有 Agent 的写操作/命令执行都必须经过此沙盒的审批网关。
 */
export class ExecutionSandbox {
    private mode: ExecutionMode;
    private askUser: AskUserCallback;
    private reviewer?: AISecondaryReviewer;

    // Phase 15.1: 级联权限引擎
    public readonly permission: PermissionNext;

    constructor(
        mode: ExecutionMode = 'default',
        askUser: AskUserCallback,
        reviewer?: AISecondaryReviewer
    ) {
        this.mode = mode;
        this.askUser = askUser;
        this.reviewer = reviewer;

        // 初始化 PermissionNext，使用原来的白名单作为 Base 层
        this.permission = new PermissionNext({
            'read_file': 'allow', // 读操作默认安全
            'run_command:git *': 'allow',
            'run_command:ls *': 'allow',
            'run_command:dir *': 'allow',
            'run_command:cat *': 'allow',
            'run_command:type *': 'allow',
            'run_command:echo *': 'allow',
            'run_command:pwd *': 'allow',
            'run_command:cd *': 'allow',
            'run_command:node --version': 'allow',
            'run_command:npm ls *': 'allow',
            'run_command:npm list *': 'allow',
            'run_command:npm audit *': 'allow',
            'run_command:npm outdated *': 'allow',
            // 一些危险命令的黑名单形式，可以在 Base 层里定义
            'run_command:rm -rf *': 'deny',
            'run_command:rmdir /s *': 'deny',
            'run_command:del /s *': 'deny',
            'run_command:mkfs.*': 'deny',
            'run_command:dd *': 'deny',
        });
    }

    public getMode(): ExecutionMode {
        return this.mode;
    }

    public setMode(mode: ExecutionMode): void {
        this.mode = mode;
    }

    /**
     * 请求执行某个操作的审批。
     * 结合 PermissionNext 和原来的沙盒模式。
     */
    public async requestApproval(actionType: ActionType, detail: string): Promise<ApprovalResult> {
        // 先检查 Permission Cascade
        const permAction = this.permission.check(actionType, detail);

        if (permAction === 'deny') {
            return {
                approved: false,
                reason: `Permission denied by cascade rule for ${actionType}.`
            };
        }

        if (permAction === 'allow') {
            return { approved: true };
        }

        // permAction === 'ask', 降级到原有的模式逻辑
        const risk = classifyRisk(actionType, detail);

        switch (this.mode) {
            case 'yolo':
                return { approved: true };

            case 'smart':
                return this.handleSmartMode(actionType, detail, risk);

            case 'default':
                return this.handleDefaultMode(actionType, detail, risk);

            case 'plan':
                return this.handlePlanMode(actionType, detail, risk);

            case 'accept_edits':
                return this.handleAcceptEditsMode(actionType);

            default:
                return { approved: false, reason: `Unknown execution mode: ${this.mode}` };
        }
    }

    // ─── SMART 模式：三级智能审批 ───
    private async handleSmartMode(
        actionType: ActionType,
        detail: string,
        risk: RiskLevel
    ): Promise<ApprovalResult> {
        // 第一级：白名单直通
        if (risk === 'safe') {
            return { approved: true };
        }

        // 第二级：黑名单阻断（需人类再确认）
        if (risk === 'dangerous') {
            const answer = await this.askUser(
                `⚠️ DANGEROUS ACTION BLOCKED\nType: ${actionType}\nDetail: ${detail}\n\nDo you want to allow this? (yes/no)`,
                'This action matched a blacklist pattern and is potentially destructive.'
            );
            return {
                approved: answer.trim().toLowerCase() === 'yes',
                reason: risk === 'dangerous' ? 'Blacklisted pattern — required human approval' : undefined,
            };
        }

        // 第三级：中等风险，转交 AI 二次审阅
        if (this.reviewer) {
            console.log(`[Sandbox:SMART] Running AI Secondary Review for: ${actionType} — ${detail.slice(0, 80)}`);
            const review = await this.reviewer.reviewAction(actionType, detail);
            if (review.approved) {
                console.log(`[Sandbox:SMART] AI Approved. Reason: ${review.reason}`);
                return { approved: true };
            } else {
                // 如果 AI 拒绝，退回到人类确认
                console.warn(`[Sandbox:SMART] AI Rejected. Reason: ${review.reason}`);
                const answer = await this.askUser(
                    `🤖 AI Review Failed\nReason: ${review.reason}\nAction: ${actionType}\nDetail: ${detail}\n\nApprove manually? (yes/no)`
                );
                return { approved: answer.trim().toLowerCase() === 'yes' };
            }
        }

        // 兼容降级：如果没有提供 reviewer，直接退回到人类确认
        const answerFallback = await this.askUser(
            `🔒 Approval Required (Unknown Risk)\nAction: ${actionType}\nDetail: ${detail}\n\nApprove? (yes/no)`
        );
        return { approved: answerFallback.trim().toLowerCase() === 'yes' };
    }

    // ─── DEFAULT 模式：所有写操作需确认 ───
    private async handleDefaultMode(
        actionType: ActionType,
        detail: string,
        risk: RiskLevel
    ): Promise<ApprovalResult> {
        if (risk === 'safe') {
            return { approved: true };
        }

        const answer = await this.askUser(
            `🔒 Approval Required\nAction: ${actionType}\nDetail: ${detail}\n\nApprove? (yes/no)`
        );
        return { approved: answer.trim().toLowerCase() === 'yes' };
    }

    // ─── PLAN 模式：必须在 Plan 内才能执行 ───
    private async handlePlanMode(
        actionType: ActionType,
        detail: string,
        _risk: RiskLevel
    ): Promise<ApprovalResult> {
        if (actionType === 'read_file') {
            return { approved: true };
        }

        // Plan 模式下，所有非读操作都先呈现给用户
        const answer = await this.askUser(
            `📋 PLAN MODE — Step requires approval\nAction: ${actionType}\nDetail: ${detail}\n\nExecute this step? (yes/no)`
        );
        return { approved: answer.trim().toLowerCase() === 'yes' };
    }

    // ─── ACCEPT_EDITS 模式：仅允许编辑，禁运命令和新建 ───
    private handleAcceptEditsMode(actionType: ActionType): ApprovalResult {
        if (actionType === 'read_file' || actionType === 'edit_file') {
            return { approved: true };
        }
        return {
            approved: false,
            reason: `ACCEPT_EDITS mode: action "${actionType}" is not permitted. Only read and edit operations are allowed.`,
        };
    }
}

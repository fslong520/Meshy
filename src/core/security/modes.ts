/**
 * Execution Mode Definitions for the Meshy Security Guard
 */
export enum ExecutionMode {
    /**
     * (Recommended) Analyzes the risk of each tool/command.
     * Always allows safe commands (read, ls).
     * Suspends and asks for user approval for risky commands (rm, write, network).
     */
    SMART = 'smart',

    /**
     * Every single command and file write requires explicit user approval.
     */
    DEFAULT = 'default',

    /**
     * The Agent is forced to emit a comprehensive plan first.
     * Execution strictly adheres to the approved plan.
     */
    PLAN = 'plan',

    /**
     * Disables the BashTool and Command Execution entirely.
     * The Agent can only edit and write files locally.
     */
    ACCEPT_EDITS = 'accept_edits',

    /**
     * Complete Autonomy.
     * The Agent can execute any command without asking for permission.
     * Use with caution or in isolated sandboxes.
     */
    YOLO = 'yolo',
}

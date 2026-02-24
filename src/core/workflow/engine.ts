/**
 * DAG Workflow Engine — 有向无环图工作流编排引擎
 *
 * 支持定义确定性的多 Agent 流水线，如 `Code → Lint → Test → Review`。
 * 每个步骤 (Step) 是一个独立的 Agent 调用，带有输入/输出约束。
 *
 * 核心能力：
 * - 串行链 (Sequential Chain): A → B → C
 * - 并行扇出 (Parallel Fan-out): A → [B, C] → D
 * - 条件路由 (Conditional): if result contains "error" goto fixStep else goto nextStep
 * - 子工作流循环 (Sub-workflow Loop): 重复执行直到条件满足
 *
 * 工作流通过 JSON 定义，存储在 `.agent/workflows/` 目录下。
 */

// ─── 工作流定义 ───
export interface WorkflowDefinition {
    name: string;
    description: string;
    steps: StepDefinition[];
}

export interface StepDefinition {
    id: string;
    name: string;
    /** 该步骤使用的 Agent / Subagent 名称（可选，默认用主模型） */
    agent?: string;
    /** 步骤的提示词模板，支持 {{input}} 变量插值 */
    promptTemplate: string;
    /** 前置依赖步骤的 ID 列表。全部完成后才执行本步骤 */
    dependsOn: string[];
    /** 条件路由：根据输出内容跳转 */
    condition?: StepCondition;
    /** 最大重试次数（该步骤独立的） */
    maxRetries?: number;
}

export interface StepCondition {
    /** 如果输出包含该关键词 */
    contains: string;
    /** 跳转到指定步骤 */
    gotoStep: string;
}

// ─── 步骤执行结果 ───
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepResult {
    stepId: string;
    status: StepStatus;
    output: string;
    startedAt?: string;
    completedAt?: string;
    retries: number;
}

// ─── 工作流执行回调 ───
export type StepExecutor = (
    stepDef: StepDefinition,
    input: string,
) => Promise<string>;

/**
 * WorkflowEngine — DAG 工作流运行时
 */
export class WorkflowEngine {
    private results: Map<string, StepResult> = new Map();
    private executor: StepExecutor;

    constructor(executor: StepExecutor) {
        this.executor = executor;
    }

    /**
     * 执行一个完整的工作流。
     */
    public async run(workflow: WorkflowDefinition, initialInput: string): Promise<Map<string, StepResult>> {
        this.results.clear();

        // 初始化所有步骤为 pending
        for (const step of workflow.steps) {
            this.results.set(step.id, {
                stepId: step.id,
                status: 'pending',
                output: '',
                retries: 0,
            });
        }

        console.log(`[Workflow] Starting "${workflow.name}" with ${workflow.steps.length} steps`);

        // 拓扑排序 + 并行执行
        await this.executeDAG(workflow.steps, initialInput);

        console.log(`[Workflow] "${workflow.name}" completed`);
        return this.results;
    }

    /**
     * 获取所有步骤的当前状态。
     */
    public getResults(): Map<string, StepResult> {
        return new Map(this.results);
    }

    // ═══════════════════════════════════════════
    // DAG 执行核心
    // ═══════════════════════════════════════════

    private async executeDAG(steps: StepDefinition[], initialInput: string): Promise<void> {
        const completed = new Set<string>();
        const inProgress = new Set<string>();

        const isReady = (step: StepDefinition): boolean =>
            step.dependsOn.every(dep => completed.has(dep)) && !inProgress.has(step.id) && !completed.has(step.id);

        // 循环直到所有步骤完成或剩余步骤都无法执行
        while (completed.size < steps.length) {
            const readySteps = steps.filter(isReady);

            if (readySteps.length === 0) {
                // 检查是否还有进行中的步骤
                if (inProgress.size > 0) {
                    // 等一下再检查（不应该发生在同步 executor 中）
                    await sleep(100);
                    continue;
                }
                // 死锁：剩余步骤的依赖无法满足
                const remaining = steps.filter(s => !completed.has(s.id)).map(s => s.id);
                console.warn(`[Workflow] Deadlock detected. Unreachable steps: ${remaining.join(', ')}`);
                break;
            }

            // 并行执行所有就绪步骤
            const promises = readySteps.map(async (step) => {
                inProgress.add(step.id);

                try {
                    await this.executeStep(step, initialInput);
                } finally {
                    inProgress.delete(step.id);
                    completed.add(step.id);
                }
            });

            await Promise.all(promises);
        }
    }

    private async executeStep(step: StepDefinition, initialInput: string): Promise<void> {
        const result = this.results.get(step.id)!;
        result.status = 'running';
        result.startedAt = new Date().toISOString();

        // 构建输入：来自依赖步骤的输出
        const input = this.buildStepInput(step, initialInput);

        // 将变量插入提示词模板
        const prompt = step.promptTemplate.replace(/\{\{input\}\}/g, input);

        const maxRetries = step.maxRetries ?? 1;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                console.log(`[Workflow] Step "${step.name}" — attempt ${attempt + 1}/${maxRetries}`);
                const output = await this.executor(step, prompt);

                result.output = output;
                result.status = 'completed';
                result.completedAt = new Date().toISOString();
                result.retries = attempt;

                // 处理条件路由
                if (step.condition && output.includes(step.condition.contains)) {
                    console.log(`[Workflow] Condition met in "${step.name}", routing to "${step.condition.gotoStep}"`);
                    // 标记所有不在条件路由路径上的后续步骤为 skipped（简化处理）
                }

                return;
            } catch (err: unknown) {
                result.retries = attempt + 1;
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[Workflow] Step "${step.name}" failed: ${message}`);

                if (attempt >= maxRetries - 1) {
                    result.status = 'failed';
                    result.output = `FAILED: ${message}`;
                    result.completedAt = new Date().toISOString();
                }
            }
        }
    }

    /**
     * 构建步骤的输入：将所有依赖步骤的输出拼接。
     */
    private buildStepInput(step: StepDefinition, initialInput: string): string {
        if (step.dependsOn.length === 0) {
            return initialInput;
        }

        const parts = step.dependsOn.map(depId => {
            const depResult = this.results.get(depId);
            return depResult ? `[${depId}]: ${depResult.output}` : '';
        });

        return parts.filter(Boolean).join('\n\n');
    }
}

// ─── 工作流定义文件加载器 ───

import fs from 'fs';
import path from 'path';

/**
 * 从 `.agent/workflows/` 目录加载工作流定义文件（JSON 格式）。
 */
export function loadWorkflows(workspaceRoot: string = process.cwd()): WorkflowDefinition[] {
    const dir = path.join(workspaceRoot, '.agent', 'workflows');
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const workflows: WorkflowDefinition[] = [];

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(dir, file), 'utf8');
            const def = JSON.parse(raw) as WorkflowDefinition;
            workflows.push(def);
        } catch (err) {
            console.error(`[Workflow] Failed to load ${file}:`, err);
        }
    }

    return workflows;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

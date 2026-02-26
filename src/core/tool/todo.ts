/**
 * TodoWrite / TodoRead — Agent 结构化任务追踪工具
 *
 * 利用 Session.blackboard.tasks 实现多步骤任务进度管理。
 * Agent 可自主创建、更新、查询任务列表。
 */

import { z } from 'zod';
import { defineTool, type ToolDefinition } from './index.js';
import type { Session } from '../session/state.js';

// ─── 任务状态枚举 ───
const TASK_STATUS = z.enum(['pending', 'in_progress', 'completed', 'failed']);

/** 创建 todoWrite 工具定义 */
export function createTodoWriteTool(getSession: () => Session): ToolDefinition {
    return defineTool('todoWrite', {
        description: 'Create or update task list in the blackboard. Use to track multi-step progress.',
        parameters: z.object({
            tasks: z.array(z.object({
                id: z.string().describe('Unique task identifier (e.g. "1", "2a")'),
                description: z.string().describe('Task description'),
                status: TASK_STATUS.describe('Current status'),
            })).describe('Full task list — replaces existing tasks'),
        }),
        async execute(args) {
            const session = getSession();
            session.updateBlackboard({ tasks: args.tasks });

            const pending = args.tasks.filter(t => t.status === 'pending').length;
            const inProgress = args.tasks.filter(t => t.status === 'in_progress').length;
            const completed = args.tasks.filter(t => t.status === 'completed').length;
            const failed = args.tasks.filter(t => t.status === 'failed').length;

            return {
                output: [
                    `Task list updated (${args.tasks.length} tasks):`,
                    `  ⏳ Pending: ${pending}  🔄 In Progress: ${inProgress}  ✅ Completed: ${completed}  ❌ Failed: ${failed}`,
                ].join('\n'),
            };
        },
    });
}

/** 创建 todoRead 工具定义 */
export function createTodoReadTool(getSession: () => Session): ToolDefinition {
    return defineTool('todoRead', {
        description: 'Read the current task list from the blackboard to check progress.',
        parameters: z.object({}),
        async execute() {
            const session = getSession();
            const { tasks } = session.blackboard;

            if (tasks.length === 0) {
                return { output: 'No tasks tracked. Use todoWrite to create a task list.' };
            }

            const STATUS_ICONS: Record<string, string> = {
                pending: '⏳',
                in_progress: '🔄',
                completed: '✅',
                failed: '❌',
            };

            const lines = tasks.map(t => {
                const icon = STATUS_ICONS[t.status] ?? '?';
                return `  ${icon} [${t.id}] ${t.description} (${t.status})`;
            });

            const completed = tasks.filter(t => t.status === 'completed').length;
            const total = tasks.length;

            return {
                output: [
                    `Task Progress: ${completed}/${total} completed`,
                    ...lines,
                ].join('\n'),
            };
        },
    });
}

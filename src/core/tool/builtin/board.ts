import { defineTool } from '../index.js';
import { z } from 'zod';
import { CollaborativeBlackboard } from '../../workspace/blackboard.js';
import path from 'path';

export function createBlackboardTools() {
    return [
        defineTool('readBlackboard', {
            description: 'Read the shared collaborative blackboard state (JSON). If key is provided, returns that specific value; otherwise, returns the whole board state.',
            parameters: z.object({
                key: z.string().describe('The state key to read. Max 50 chars.').optional(),
            }),
            async execute(args, context) {
                if (!context || !context.workspaceRoot) {
                    return { output: JSON.stringify({ error: 'No workspace context available to find the blackboard.' }) };
                }

                // Instead of expecting the blackboard instance on context, we temporarily instantiate it for reading
                // Note: since it reads/writes from the disk syncronously, it's safe to do so.
                // Ideally `context.workspace` would be passed, but for now we mount it per call:
                const board = new CollaborativeBlackboard(context.workspaceRoot);
                const result = board.read(args.key);
                return { output: JSON.stringify({ result }) };
            }
        }),
        defineTool('writeBlackboard', {
            description: 'Write or update a key-value pair on the shared collaborative blackboard. Use this to pass information across Agent Workers instead of dropping text into your own context window.',
            parameters: z.object({
                key: z.string().describe('The state key to write to. Use descriptive names like "database_schema" or "task_1_status"'),
                value: z.any().describe('The JSON value to store. Can be strings, numbers, objects, or arrays.'),
            }),
            async execute(args, context) {
                if (!context || !context.workspaceRoot) {
                    return { output: JSON.stringify({ error: 'No workspace context available to find the blackboard.' }) };
                }

                const board = new CollaborativeBlackboard(context.workspaceRoot);
                board.write(args.key, args.value);
                return { output: JSON.stringify({ success: true, message: `Successfully wrote key "${args.key}" to the blackboard.` }) };
            }
        }),
    ];
}

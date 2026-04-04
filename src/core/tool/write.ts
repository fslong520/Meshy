/**
 * Write Tool — 文件全量写入工具
 *
 * 用于创建新文件或完全覆写现有文件内容。
 * 与 editFile 的区别：write 是全量写入，edit 是精确块替换。
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { defineTool } from './define.js';

export const WriteTool = defineTool('write', {
    description: [
        'Write content to a file. Creates the file (and parent directories) if it does not exist.',
        'If the file already exists, it will be COMPLETELY OVERWRITTEN.',
        'For partial edits to existing files, use the editFile tool instead.',
        'Always provide the COMPLETE file content — do not use placeholders or omit sections.',
    ].join('\n'),
    parameters: z.object({
        filePath: z.string().describe('The absolute path to the file to write (must be absolute, not relative)'),
        content: z.string().describe('The complete content to write to the file'),
    }),
    manifest: {
        permissionClass: 'write',
    },
    async execute(params, ctx) {
        let filePath = params.filePath;
        if (!path.isAbsolute(filePath)) {
            filePath = path.resolve(ctx.workspaceRoot, filePath);
        }

        // 确保父目录存在
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const existed = fs.existsSync(filePath);
        fs.writeFileSync(filePath, params.content, 'utf8');

        const relativePath = path.relative(ctx.workspaceRoot, filePath);
        const action = existed ? 'Updated' : 'Created';

        return {
            output: `${action} file: ${relativePath}`,
            metadata: { filePath, existed },
        };
    },
});

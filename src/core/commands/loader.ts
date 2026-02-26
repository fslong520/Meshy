/**
 * Markdown Command Loader — 用户自定义斜杠命令加载器
 *
 * 从 `.meshy/commands/*.md` 目录加载 Markdown 格式的自定义命令。
 * 每个 .md 文件定义一个命令，包含：
 *   - YAML Frontmatter: name, description, model (可选)
 *   - Markdown Body: 命令的 Prompt 模板，支持 `$ARGUMENTS` 占位符
 *
 * 示例文件 `.meshy/commands/review.md`:
 * ```
 * ---
 * name: review
 * description: 代码审查并输出建议
 * model: gpt-4o
 * ---
 * 请对以下代码进行全面的 Code Review，指出潜在问题和改进建议。
 *
 * $ARGUMENTS
 * ```
 */

import fs from 'fs';
import path from 'path';

// ─── 自定义命令配置 ───
export interface CustomCommandConfig {
    /** 命令名称（即 `/name`） */
    name: string;
    /** 描述信息（用于 /help 展示） */
    description: string;
    /** 可选绑定模型 */
    model?: string;
    /** Prompt 模板（Body），包含 $ARGUMENTS 占位符 */
    promptTemplate: string;
    /** 原始文件路径 */
    filePath: string;
}

// ─── Frontmatter 解析（与 SubagentRegistry 保持一致的简易实现） ───
const YAML_FENCE_REGEX = /^---\s*\n([\s\S]*?)\n---/;

function parseKeyValueBlock(block: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        result[key] = value;
    }
    return result;
}

/**
 * CustomCommandRegistry — 自定义命令注册表
 */
export class CustomCommandRegistry {
    private commands: Map<string, CustomCommandConfig> = new Map();
    private commandsDir: string;

    constructor(workspaceRoot: string = process.cwd()) {
        this.commandsDir = path.join(workspaceRoot, '.meshy', 'commands');
    }

    /** 扫描 .meshy/commands/ 目录，加载所有 .md 命令定义 */
    public scan(): void {
        if (!fs.existsSync(this.commandsDir)) return;

        const files = fs.readdirSync(this.commandsDir).filter(f => f.endsWith('.md'));

        for (const file of files) {
            const filePath = path.join(this.commandsDir, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                const config = this.parseCommandFile(raw, filePath, file);
                if (config) {
                    this.commands.set(config.name, config);
                }
            } catch {
                // 静默跳过解析失败的文件
            }
        }
    }

    /** 解析单个命令文件 */
    private parseCommandFile(raw: string, filePath: string, filename: string): CustomCommandConfig | null {
        const yamlMatch = raw.match(YAML_FENCE_REGEX);
        if (!yamlMatch) return null;

        const meta = parseKeyValueBlock(yamlMatch[1]);
        const body = raw.slice(yamlMatch[0].length).trim();

        const name = meta.name || filename.replace(/\.md$/, '');
        if (!name) return null;

        return {
            name: name.toLowerCase(),
            description: meta.description || '',
            model: meta.model || undefined,
            promptTemplate: body,
            filePath,
        };
    }

    /** 获取命令 */
    public getCommand(name: string): CustomCommandConfig | undefined {
        return this.commands.get(name.toLowerCase());
    }

    /** 列出所有自定义命令 */
    public listCommands(): CustomCommandConfig[] {
        return Array.from(this.commands.values());
    }

    /** 检查命令是否存在 */
    public has(name: string): boolean {
        return this.commands.has(name.toLowerCase());
    }

    /** 将 $ARGUMENTS 替换为实际参数，生成最终 Prompt */
    public renderPrompt(name: string, args: string): string | null {
        const cmd = this.commands.get(name.toLowerCase());
        if (!cmd) return null;

        return cmd.promptTemplate.replace(/\$ARGUMENTS/g, args || '');
    }
}

/**
 * Permission Cascade Engine — 级联权限验证
 *
 * 实现了从宽到严的权限收窄模型，每一层只能进一步限制权限，不能恢复上层已禁止的权限。
 * 层级（优先级从高到低）：
 *  1. Base (最宽泛的默认权限组，例如 `default_safe`)
 *  2. Global/User (用户全局配置 `~/.config/meshy/config.json`)
 *  3. Agent (Agent 的配置 `.meshy/agents/*.md`)
 *  4. Override (执行时的临时上下文覆盖)
 */

import { z } from 'zod';
import { ActionType } from './execution.js';
import micromatch from 'micromatch'; // 需要 npm install micromatch

export type PermissionAction = 'allow' | 'ask' | 'deny';

// 单个工具的权限定义字典 (如 "editFile": "allow", "run_command:git*": "allow")
export type PermissionDict = Record<string, PermissionAction>;

export const PermissionDictSchema = z.record(z.enum(['allow', 'ask', 'deny']));

export class PermissionNext {
    private base: PermissionDict = {};
    private user: PermissionDict = {};
    private agent: PermissionDict = {};
    private override: PermissionDict = {};

    constructor(base?: PermissionDict) {
        if (base) this.base = base;
    }

    public setUser(dict: PermissionDict) {
        this.user = dict;
    }

    public setAgent(dict: PermissionDict) {
        this.agent = dict;
    }

    public setOverride(dict: PermissionDict) {
        this.override = dict;
    }

    /**
     * 判断是否具有指定操作的具体权限。
     * priority: override > agent > user > base
     * 如果某个上层是 deny，下层无法覆盖为 allow。
     * 从最下层 (base) 解析到最上层 (override)，维持"严格单调收窄"。
     */
    public check(actionType: ActionType, detail?: string): PermissionAction {
        const key = detail ? `${actionType}:${detail}` : actionType;

        // 默认权限
        let result: PermissionAction = 'ask';

        const layers = [this.base, this.user, this.agent, this.override];

        for (const layer of layers) {
            const val = this.matchLayer(layer, actionType, detail);
            if (!val) continue;

            // 如果当前结果已经是 deny，上层配置无法变更为 allow / ask
            if (result === 'deny') {
                continue;
            }

            // 如果当前结果是 ask，上层配置如果是 allow，依然视为起效，但如果上层级联机制严格：
            // 设定规则: 'deny' 最强, 'ask' 次之, 'allow' 最弱。
            // 但考虑到某些基础层可能是 allow，用户层设为 ask。那覆盖就生效。
            if (val === 'deny') {
                result = 'deny';
            } else if (val === 'ask') {
                result = 'ask';
            } else if (val === 'allow' && result !== 'deny' && result !== 'ask') {
                result = 'allow';
            } else if (val === 'allow' && (result === 'deny' || result === 'ask')) {
                // 不做任何事，不能恢复
            }
        }

        return result;
    }

    /** 在特定层中寻找匹配，支持通配符 */
    private matchLayer(layer: PermissionDict, actionType: ActionType, detail?: string): PermissionAction | null {
        // 精确匹配 actionType本身
        if (layer[actionType]) return layer[actionType];

        // 带细节匹配，如 'run_command:git *'
        if (detail) {
            const combined = `${actionType}:${detail}`;
            // 精确匹配
            if (layer[combined]) return layer[combined];

            // 模糊匹配
            for (const [pattern, action] of Object.entries(layer)) {
                if (pattern.includes('*') && pattern.startsWith(`${actionType}:`)) {
                    const rulePattern = pattern.substring(actionType.length + 1);
                    if (micromatch.isMatch(detail, rulePattern)) {
                        return action;
                    }
                }
            }
        }

        // 星号通配所有操作
        if (layer['*']) return layer['*'];

        return null; // 未匹配到
    }
}

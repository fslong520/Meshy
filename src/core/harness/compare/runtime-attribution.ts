import type { RuntimeDecisionDiff } from './runtime-decisions.js';

export interface RuntimeAttributionHint {
    type: 'skill_shift' | 'mcp_shift' | 'reason_shift' | 'mixed_shift' | 'none';
    summary: string;
}

export function attributeRuntimeDecisionDiff(diff: RuntimeDecisionDiff): RuntimeAttributionHint {
    if (diff.loops.length === 0 || diff.loops.every(loop => loop.status === 'unchanged')) {
        return {
            type: 'none',
            summary: 'No material runtime decision difference was detected between the two reports.',
        };
    }

    let skillChangedLoops = 0;
    let mcpChangedLoops = 0;
    let reasonChangedLoops = 0;

    for (const loop of diff.loops) {
        const skillChanged = loop.injectedSkillsAdded.length > 0 || loop.injectedSkillsRemoved.length > 0;
        const mcpChanged = loop.activeMcpAdded.length > 0 || loop.activeMcpRemoved.length > 0;
        if (skillChanged) skillChangedLoops++;
        if (mcpChanged) mcpChangedLoops++;
        if (loop.reasonChanged) reasonChangedLoops++;
    }

    if (skillChangedLoops > 0 && mcpChangedLoops > 0) {
        return {
            type: 'mixed_shift',
            summary: 'Runtime behavior changed across multiple decision dimensions, including skill injection and MCP activation.',
        };
    }

    if (skillChangedLoops > 0) {
        return {
            type: 'skill_shift',
            summary: 'Runtime behavior changed mainly because the injected skill set changed between the two runs.',
        };
    }

    if (mcpChangedLoops > 0) {
        return {
            type: 'mcp_shift',
            summary: 'Runtime behavior changed mainly because the active MCP environment changed between the two runs.',
        };
    }

    if (reasonChangedLoops > 0) {
        return {
            type: 'reason_shift',
            summary: 'Runtime selection reasoning changed while the visible capability sets stayed similar.',
        };
    }

    return {
        type: 'none',
        summary: 'No material runtime decision difference was detected between the two reports.',
    };
}

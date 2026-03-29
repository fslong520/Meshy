import type { HarnessReport } from '../artifacts/types.js';
import type { RuntimeDecisionRecord } from '../../session/state.js';

export interface RuntimeDecisionLoopDiff {
    loopIndex: number;
    status: 'unchanged' | 'modified' | 'added' | 'removed';
    injectedSkillsAdded: string[];
    injectedSkillsRemoved: string[];
    activeMcpAdded: string[];
    activeMcpRemoved: string[];
    reasonChanged: boolean;
    beforeReason?: string;
    afterReason?: string;
}

export interface RuntimeDecisionDiff {
    loopCountDelta: number;
    loops: RuntimeDecisionLoopDiff[];
}

function diffSet(before: string[], after: string[]) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return {
        added: Array.from(afterSet).filter(value => !beforeSet.has(value)).sort(),
        removed: Array.from(beforeSet).filter(value => !afterSet.has(value)).sort(),
    };
}

export function diffRuntimeDecisions(before: Pick<HarnessReport, 'runtimeDecisions'>, after: Pick<HarnessReport, 'runtimeDecisions'>): RuntimeDecisionDiff {
    const beforeMap = new Map<number, RuntimeDecisionRecord>((before.runtimeDecisions ?? []).map(decision => [decision.loopIndex, decision]));
    const afterMap = new Map<number, RuntimeDecisionRecord>((after.runtimeDecisions ?? []).map(decision => [decision.loopIndex, decision]));
    const loopIndexes = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort((a, b) => a - b);

    const loops: RuntimeDecisionLoopDiff[] = loopIndexes.map(loopIndex => {
        const beforeDecision = beforeMap.get(loopIndex);
        const afterDecision = afterMap.get(loopIndex);

        if (!beforeDecision && afterDecision) {
            return {
                loopIndex,
                status: 'added',
                injectedSkillsAdded: [...afterDecision.injectedSkills].sort(),
                injectedSkillsRemoved: [],
                activeMcpAdded: [...afterDecision.activeMcpServers].sort(),
                activeMcpRemoved: [],
                reasonChanged: true,
                beforeReason: undefined,
                afterReason: afterDecision.reasonSummary,
            };
        }

        if (beforeDecision && !afterDecision) {
            return {
                loopIndex,
                status: 'removed',
                injectedSkillsAdded: [],
                injectedSkillsRemoved: [...beforeDecision.injectedSkills].sort(),
                activeMcpAdded: [],
                activeMcpRemoved: [...beforeDecision.activeMcpServers].sort(),
                reasonChanged: true,
                beforeReason: beforeDecision.reasonSummary,
                afterReason: undefined,
            };
        }

        const skillDiff = diffSet(beforeDecision?.injectedSkills ?? [], afterDecision?.injectedSkills ?? []);
        const mcpDiff = diffSet(beforeDecision?.activeMcpServers ?? [], afterDecision?.activeMcpServers ?? []);
        const reasonChanged = beforeDecision?.reasonSummary !== afterDecision?.reasonSummary;
        const changed = skillDiff.added.length > 0 || skillDiff.removed.length > 0 || mcpDiff.added.length > 0 || mcpDiff.removed.length > 0 || reasonChanged;

        return {
            loopIndex,
            status: changed ? 'modified' : 'unchanged',
            injectedSkillsAdded: skillDiff.added,
            injectedSkillsRemoved: skillDiff.removed,
            activeMcpAdded: mcpDiff.added,
            activeMcpRemoved: mcpDiff.removed,
            reasonChanged,
            beforeReason: beforeDecision?.reasonSummary,
            afterReason: afterDecision?.reasonSummary,
        };
    });

    return {
        loopCountDelta: (after.runtimeDecisions ?? []).length - (before.runtimeDecisions ?? []).length,
        loops,
    };
}

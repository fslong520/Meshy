import type { RuntimeDecisionRecord } from '../../session/state.js';
import type { ReplayExport } from '../../session/replay.js';

export interface FixtureExpectation {
    finalStatus?: 'passed' | 'failed';
    outputMarkers?: string[];
    requiredTools?: string[];
}

export interface ScenarioFixture {
    schemaVersion: 1;
    id: string;
    title: string;
    sourceReplayId: string;
    createdAt: string;
    goal?: string;
    environment?: {
        workspaceRoot?: string;
        openFiles?: string[];
    };
    expected: FixtureExpectation;
    replay: ReplayExport;
}

export interface FailureAttribution {
    type: 'tool_error' | 'context_miss' | 'timeout' | 'sandbox_denied' | 'bad_output' | 'unknown';
    summary: string;
}

export interface HarnessScoreBreakdown {
    goalCompletion: number;
    outputMatch: number;
    toolUsageMatch: number;
}

export interface HarnessRunRecord {
    schemaVersion: 1;
    id: string;
    fixtureId: string;
    startedAt: string;
    finishedAt?: string;
    status: 'passed' | 'failed';
    scores: HarnessScoreBreakdown;
    attribution?: FailureAttribution;
}

export interface HarnessReport {
    schemaVersion: 1;
    id: string;
    fixtureId: string;
    runId: string;
    createdAt: string;
    status: 'passed' | 'failed';
    scores: HarnessScoreBreakdown;
    attribution?: FailureAttribution;
    summary: string;
    runtimeDecisions: RuntimeDecisionRecord[];
}

export interface HarnessRunResult {
    runId: string;
    reportId?: string;
    status: 'passed' | 'failed';
    scores: HarnessScoreBreakdown;
    attribution?: FailureAttribution;
}

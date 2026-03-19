import fs from 'fs';
import path from 'path';
import type { HarnessReport, HarnessRunRecord, ScenarioFixture } from './types.js';

export class HarnessArtifactStore {
    constructor(private readonly workspaceRoot: string) {}

    async saveFixture(fixture: ScenarioFixture): Promise<string> {
        this.writeArtifact('fixtures', fixture.id, fixture);
        return fixture.id;
    }

    async loadFixture(id: string): Promise<ScenarioFixture | null> {
        return this.readArtifact<ScenarioFixture>('fixtures', id);
    }

    async saveRun(run: HarnessRunRecord): Promise<string> {
        this.writeArtifact('runs', run.id, run);
        return run.id;
    }

    async loadRun(id: string): Promise<HarnessRunRecord | null> {
        return this.readArtifact<HarnessRunRecord>('runs', id);
    }

    async saveReport(report: HarnessReport): Promise<string> {
        this.writeArtifact('reports', report.id, report);
        return report.id;
    }

    async loadReport(id: string): Promise<HarnessReport | null> {
        return this.readArtifact<HarnessReport>('reports', id);
    }

    private writeArtifact(kind: 'fixtures' | 'runs' | 'reports', id: string, value: unknown): void {
        const dir = path.join(this.workspaceRoot, '.meshy', 'harness', kind);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(value, null, 2), 'utf8');
    }

    private readArtifact<T>(kind: 'fixtures' | 'runs' | 'reports', id: string): T | null {
        const filePath = path.join(this.workspaceRoot, '.meshy', 'harness', kind, `${id}.json`);
        if (!fs.existsSync(filePath)) {
            return null;
        }

        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    }
}

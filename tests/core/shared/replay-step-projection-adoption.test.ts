import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('shared replay step projection adoption', () => {
    it('uses projected replay steps in core and hydration paths', () => {
        const coreSource = read('src/core/session/replay.ts');
        const hydrationSource = read('web/src/store/replay-hydration.ts');

        expect(coreSource).toContain('projected:');
        expect(coreSource).toContain("from '../../shared/replay-step-projection.js'");
        expect(coreSource).toContain('getReplayStepProjection(step)');
        expect(hydrationSource).toContain("from '../../../src/shared/replay-step-projection.js'");
        expect(hydrationSource).toContain('getReplayStepProjection(step)');
        expect(hydrationSource).not.toContain('const raw = step.raw');
    });
});

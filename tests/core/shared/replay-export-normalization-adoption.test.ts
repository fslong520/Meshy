import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('shared replay export normalization adoption', () => {
    it('uses the shared replay export normalizer from core and web entrypoints', () => {
        const coreSource = read('src/core/session/replay.ts');
        const webSource = read('web/src/store/replay-hydration.ts');

        expect(coreSource).toContain("from '../../shared/replay-export-normalization.js'");
        expect(coreSource).not.toContain('function normalizeReplay(');

        expect(webSource).toContain("from '../../../src/shared/replay-export-normalization.js'");
    });
});

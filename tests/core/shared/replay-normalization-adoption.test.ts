import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('shared replay normalization adoption', () => {
    it('uses the shared replay normalizer from core and web entrypoints', () => {
        const coreSource = read('src/core/session/replay.ts');
        const exportNormalizerSource = read('src/shared/replay-export-normalization.ts');
        const webSource = read('web/src/store/replay-hydration.ts');

        expect(coreSource).toContain("from '../../shared/replay-export-normalization.js'");
        expect(exportNormalizerSource).toContain("from './replay-normalization.js'");
        expect(coreSource).not.toContain('function normalizeReplayEvents(');

        expect(webSource).toContain("from '../../../src/shared/replay-normalization.js'");
        expect(webSource).not.toContain('function normalizeReplayEvents(');
    });
});

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('shared replay event derivation adoption', () => {
    it('uses the shared replay derivation helper from core replay export flow', () => {
        const coreSource = read('src/core/session/replay.ts');

        expect(coreSource).toContain("from '../../shared/replay-event-derivation.js'");
        expect(coreSource).not.toContain('events.push({');
        expect(coreSource).not.toContain('return events.sort(');
    });
});

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('shared replay contract adoption', () => {
    it('uses the shared replay contract from web hydration and app entrypoints', () => {
        const hydrationSource = read('web/src/store/replay-hydration.ts');
        const appSource = read('web/src/App.tsx');

        expect(hydrationSource).toContain("from '../../../src/shared/replay-contract.js'");
        expect(hydrationSource).not.toContain('interface ReplayStep');
        expect(hydrationSource).not.toContain('interface ReplayExport');

        expect(appSource).toContain("from '../../src/shared/replay-contract.js'");
        expect(appSource).not.toContain('interface ReplayExport');
    });
});

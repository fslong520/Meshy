import { describe, expectTypeOf, it } from 'vitest';
import type { ReplayEvent, ReplayExport, ReplayStep } from '../../../src/shared/replay-contract.js';
import { exportReplay } from '../../../src/core/session/replay.js';
import { Session } from '../../../src/core/session/state.js';

describe('shared replay contract', () => {
    it('matches the exported replay runtime shape', () => {
        const session = new Session('shared-replay-contract');
        session.addMessage({ role: 'user', content: 'hello' });

        const replay = exportReplay(session);

        expectTypeOf(replay).toMatchTypeOf<ReplayExport>();
        expectTypeOf(replay.steps[0]).toMatchTypeOf<ReplayStep>();
        expectTypeOf(replay.events[0]).toMatchTypeOf<ReplayEvent>();
    });
});

import { describe, expect, it } from 'vitest';
import { projectActiveMcpServers } from '../../../src/core/plugins/runtime/mcp-projection.js';

describe('projectActiveMcpServers', () => {
    it('returns a deduplicated configured subset in stable order and reports ignored ids', () => {
        const result = projectActiveMcpServers({
            activeCapabilities: { mcpServers: ['filesystem', 'playwright', 'filesystem', 'typo'] },
            configuredServers: ['playwright', 'filesystem', 'github'],
        });

        expect(result).toEqual({
            mcpServers: ['playwright', 'filesystem'],
            ignored: ['typo'],
        });
    });
});

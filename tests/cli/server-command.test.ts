import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/index.js';

describe('parseArgs', () => {
    it('treats server as the webserver startup subcommand', () => {
        expect(parseArgs(['node', 'meshy', 'server', '--port', '9999'])).toMatchObject({
            subcommand: 'server',
            port: 9999,
        });
    });

    it('treats daemon as a compatibility alias for the server startup command', () => {
        expect(parseArgs(['node', 'meshy', 'daemon', '--port', '9999'])).toMatchObject({
            subcommand: 'server',
            port: 9999,
        });
    });
});

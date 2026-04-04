import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../../../src/core/tool/define.js';
import {
    DEFAULT_TOOL_MANIFEST,
    normalizeToolManifest,
} from '../../../src/core/tool/manifest.js';

describe('tool manifest', () => {
    it('normalizes manifest with defaults', () => {
        const manifest = normalizeToolManifest({ permissionClass: 'exec' });

        expect(manifest.permissionClass).toBe('exec');
        expect(manifest.concurrencySafe).toBe(DEFAULT_TOOL_MANIFEST.concurrencySafe);
        expect(manifest.retryable).toBe(DEFAULT_TOOL_MANIFEST.retryable);
        expect(manifest.outputPersistence).toBe(DEFAULT_TOOL_MANIFEST.outputPersistence);
    });

    it('attaches default manifest when defineTool receives none', async () => {
        const tool = defineTool('demo_default_manifest', {
            description: 'demo',
            parameters: z.object({}),
            async execute() {
                return { output: 'ok' };
            },
        });

        expect(tool.manifest).toMatchObject(DEFAULT_TOOL_MANIFEST);
    });

    it('preserves explicit manifest overrides in defineTool', async () => {
        const tool = defineTool('demo_custom_manifest', {
            description: 'demo',
            parameters: z.object({}),
            manifest: {
                permissionClass: 'network',
                concurrencySafe: false,
                timeoutMs: 10_000,
                retryable: true,
                outputPersistence: 'offload',
            },
            async execute() {
                return { output: 'ok' };
            },
        });

        expect(tool.manifest).toMatchObject({
            permissionClass: 'network',
            concurrencySafe: false,
            timeoutMs: 10_000,
            retryable: true,
            outputPersistence: 'offload',
        });
    });
});

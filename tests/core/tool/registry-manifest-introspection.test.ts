import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../../../src/core/tool/define.js';
import { ToolCatalog } from '../../../src/core/tool/catalog.js';
import { ToolRegistry } from '../../../src/core/tool/registry.js';

describe('ToolRegistry manifest introspection', () => {
    it('returns manifest for registered built-in tools', () => {
        const registry = new ToolRegistry();
        registry.register(defineTool('builtin_a', {
            description: 'builtin tool',
            parameters: z.object({}),
            manifest: {
                permissionClass: 'write',
                concurrencySafe: false,
                timeoutMs: 2_000,
            },
            async execute() {
                return { output: 'ok' };
            },
        }));

        const manifest = registry.getManifest('builtin_a');
        expect(manifest).toMatchObject({
            permissionClass: 'write',
            concurrencySafe: false,
            timeoutMs: 2_000,
        });
    });

    it('returns manifest for catalog tools and includes them in listManifestEntries', () => {
        const catalog = new ToolCatalog();
        const registry = new ToolRegistry(catalog);
        const tool = defineTool('lazy_a', {
            description: 'lazy tool',
            parameters: z.object({}),
            manifest: {
                permissionClass: 'network',
                timeoutMs: 5_000,
                retryable: true,
            },
            async execute() {
                return { output: 'ok' };
            },
        });

        catalog.register(tool, 'network', 'test lazy tool');

        const manifest = registry.getManifest('lazy_a');
        expect(manifest).toMatchObject({
            permissionClass: 'network',
            timeoutMs: 5_000,
            retryable: true,
        });

        const entries = registry.listManifestEntries();
        expect(entries.find((entry) => entry.id === 'lazy_a')?.manifest.permissionClass).toBe('network');
    });

    it('returns null for unknown tool manifest lookups', () => {
        const registry = new ToolRegistry();
        expect(registry.getManifest('unknown_tool')).toBeNull();
    });
});

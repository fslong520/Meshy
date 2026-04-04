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

    it('summarizes manifest entries for policy/runtime consumers', () => {
        const catalog = new ToolCatalog();
        const registry = new ToolRegistry(catalog);

        registry.register(defineTool('builtin_read', {
            description: 'builtin read',
            parameters: z.object({}),
            manifest: { permissionClass: 'read', timeoutMs: null },
            async execute() {
                return { output: 'ok' };
            },
        }));

        catalog.register(defineTool('lazy_exec', {
            description: 'lazy exec',
            parameters: z.object({}),
            manifest: { permissionClass: 'exec', timeoutMs: 1000, retryable: true },
            async execute() {
                return { output: 'ok' };
            },
        }), 'exec', 'lazy exec tool');

        const summary = registry.summarizeManifestEntries();
        expect(summary.total).toBe(2);
        expect(summary.bySource.builtin).toBe(1);
        expect(summary.bySource.catalog).toBe(1);
        expect(summary.byPermissionClass.read).toBe(1);
        expect(summary.byPermissionClass.exec).toBe(1);
        expect(summary.timeoutConfigured).toBe(1);
        expect(summary.retryable).toBe(1);
    });
});

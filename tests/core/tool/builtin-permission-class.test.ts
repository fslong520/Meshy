import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../src/core/tool/index.js';

describe('built-in tool manifest permission classes', () => {
    it('classifies high-risk tools with non-read permission classes', () => {
        const registry = createDefaultRegistry();

        expect(registry.getManifest('bash')?.permissionClass).toBe('exec');
        expect(registry.getManifest('run_command')?.permissionClass).toBe('exec');
        expect(registry.getManifest('send_command_input')?.permissionClass).toBe('exec');
        expect(registry.getManifest('webfetch')?.permissionClass).toBe('network');
        expect(registry.getManifest('websearch')?.permissionClass).toBe('network');
        expect(registry.getManifest('write')?.permissionClass).toBe('write');
        expect(registry.getManifest('writeBlackboard')?.permissionClass).toBe('write');
    });

    it('keeps read-only tools in read permission class', () => {
        const registry = createDefaultRegistry();

        expect(registry.getManifest('glob')?.permissionClass).toBe('read');
        expect(registry.getManifest('grep')?.permissionClass).toBe('read');
        expect(registry.getManifest('ls')?.permissionClass).toBe('read');
        expect(registry.getManifest('command_status')?.permissionClass).toBe('read');
        expect(registry.getManifest('readBlackboard')?.permissionClass).toBe('read');
    });

    it('marks manageTools as write-level control operation', () => {
        const registry = createDefaultRegistry();
        expect(registry.getManifest('manageTools')?.permissionClass).toBe('write');
    });
});

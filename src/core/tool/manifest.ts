export const TOOL_PERMISSION_CLASSES = [
    'read',
    'write',
    'exec',
    'network',
    'vcs',
    'external',
] as const;

export type ToolPermissionClass = typeof TOOL_PERMISSION_CLASSES[number];

export type ToolOutputPersistence = 'inline' | 'offload';

export interface ToolManifest {
    permissionClass: ToolPermissionClass;
    concurrencySafe: boolean;
    timeoutMs: number | null;
    retryable: boolean;
    outputPersistence: ToolOutputPersistence;
}

export type PartialToolManifest = Partial<ToolManifest> & Pick<ToolManifest, 'permissionClass'>;

export const DEFAULT_TOOL_MANIFEST: ToolManifest = {
    permissionClass: 'read',
    concurrencySafe: true,
    timeoutMs: null,
    retryable: false,
    outputPersistence: 'inline',
};

export function normalizeToolManifest(manifest?: PartialToolManifest): ToolManifest {
    return {
        ...DEFAULT_TOOL_MANIFEST,
        ...(manifest ?? {}),
    };
}

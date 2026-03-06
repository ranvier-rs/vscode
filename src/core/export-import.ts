import * as fs from 'node:fs/promises';
import type {
    Collection,
    CollectionRequest,
    EnvironmentConfig,
    ApiResponseData,
    ApiTimelineNode,
} from '../shared/types';
import { redactSecrets, convertRedactedToPlaceholders, type RedactionStrategy } from './secret-redactor';
import { CollectionStore } from './collection-store';
import { EnvironmentStore } from './environment-store';

// ── Bundle Format ──────────────────────────────────────────────

export type BundleManifest = {
    collections: boolean;
    environments: string[];
    snapshots: boolean;
    history: boolean;
};

export type RanvierBundle = {
    format_version: string;
    exported_at: string;
    exported_by: string;
    ranvier_version: string;
    includes: BundleManifest;
    collections: Collection[];
    environments: EnvironmentConfig[];
};

export type RanvierRequest = {
    format_version: string;
    exported_at: string;
    request: CollectionRequest;
    last_response?: ApiResponseData;
    circuit_trace?: ApiTimelineNode[];
};

export type ImportConflict = {
    type: 'collection' | 'environment';
    name: string;
    existingItemCount?: number;
};

export type ConflictResolution = 'replace' | 'skip';

const FORMAT_VERSION = '1.0.0';
const RANVIER_VERSION = '0.20.0';

// ── Export ──────────────────────────────────────────────────────

export async function exportBundle(
    store: CollectionStore,
    envStore: EnvironmentStore,
    collectionNames: string[],
    environmentNames: string[],
    redaction: RedactionStrategy,
): Promise<RanvierBundle> {
    const collections: Collection[] = [];
    for (const name of collectionNames) {
        const col = await store.loadCollection(name);
        if (col) collections.push(col);
    }

    const environments: EnvironmentConfig[] = [];
    for (const name of environmentNames) {
        const env = await envStore.loadEnvironment(name);
        if (env) environments.push(env);
    }

    const bundle: RanvierBundle = {
        format_version: FORMAT_VERSION,
        exported_at: new Date().toISOString(),
        exported_by: `vscode-ranvier`,
        ranvier_version: RANVIER_VERSION,
        includes: {
            collections: collections.length > 0,
            environments: environmentNames,
            snapshots: false,
            history: false,
        },
        collections: redactSecrets(collections, redaction),
        environments: redactSecrets(environments, redaction),
    };

    return bundle;
}

export function exportRequest(
    request: CollectionRequest,
    response?: ApiResponseData,
    trace?: ApiTimelineNode[],
): RanvierRequest {
    return {
        format_version: FORMAT_VERSION,
        exported_at: new Date().toISOString(),
        request,
        last_response: response,
        circuit_trace: trace,
    };
}

// ── Import ──────────────────────────────────────────────────────

export function parseBundle(content: string): RanvierBundle {
    const data = JSON.parse(content);
    if (!data.format_version) {
        throw new Error('Invalid bundle: missing format_version');
    }
    const [major] = data.format_version.split('.');
    if (major !== '1') {
        throw new Error(`Incompatible bundle version: ${data.format_version} (expected 1.x.x)`);
    }
    return data as RanvierBundle;
}

export function parseRequest(content: string): RanvierRequest {
    const data = JSON.parse(content);
    if (!data.format_version) {
        throw new Error('Invalid request file: missing format_version');
    }
    const [major] = data.format_version.split('.');
    if (major !== '1') {
        throw new Error(`Incompatible request version: ${data.format_version} (expected 1.x.x)`);
    }
    if (!data.request) {
        throw new Error('Invalid request file: missing request data');
    }
    return data as RanvierRequest;
}

export async function detectConflicts(
    store: CollectionStore,
    envStore: EnvironmentStore,
    bundle: RanvierBundle,
): Promise<ImportConflict[]> {
    const conflicts: ImportConflict[] = [];

    const existingCollections = await store.listCollections();
    const existingNames = new Set(existingCollections.map(c => c.name));

    for (const col of bundle.collections) {
        if (existingNames.has(col.name)) {
            const existing = existingCollections.find(c => c.name === col.name);
            conflicts.push({
                type: 'collection',
                name: col.name,
                existingItemCount: existing?.requestCount,
            });
        }
    }

    const existingEnvs = await envStore.listEnvironments();
    const existingEnvNames = new Set(existingEnvs.map(e => e.name));

    for (const env of bundle.environments) {
        if (existingEnvNames.has(env.name)) {
            conflicts.push({
                type: 'environment',
                name: env.name,
            });
        }
    }

    return conflicts;
}

export async function applyImport(
    store: CollectionStore,
    envStore: EnvironmentStore,
    bundle: RanvierBundle,
    resolution: ConflictResolution,
    conflictNames: Set<string>,
): Promise<{ collections: number; environments: number }> {
    let colCount = 0;
    let envCount = 0;

    // Convert redacted placeholders
    const collections = convertRedactedToPlaceholders(bundle.collections);
    const environments = convertRedactedToPlaceholders(bundle.environments);

    for (const col of collections) {
        const isConflict = conflictNames.has(`collection:${col.name}`);
        if (isConflict && resolution === 'skip') continue;

        await store.saveCollection(col);
        colCount++;
    }

    for (const env of environments) {
        const isConflict = conflictNames.has(`environment:${env.name}`);
        if (isConflict && resolution === 'skip') continue;

        await envStore.saveEnvironment(env);
        envCount++;
    }

    return { collections: colCount, environments: envCount };
}

export async function applyRequestImport(
    store: CollectionStore,
    collectionName: string,
    request: RanvierRequest,
): Promise<void> {
    const req = convertRedactedToPlaceholders(request.request);
    await store.saveRequest(collectionName, req);
}

export async function saveBundleToFile(bundle: RanvierBundle, filePath: string): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(bundle, null, 2), 'utf-8');
}

export async function saveRequestToFile(request: RanvierRequest, filePath: string): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(request, null, 2), 'utf-8');
}

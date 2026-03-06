import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Collection, CollectionMeta, CollectionRequest, HistoryEntry } from '../shared/types';

const SCHEMA_VERSION = '1.0.0';
const RANVIER_DIR = '.ranvier';
const COLLECTIONS_DIR = 'collections';
const HISTORY_DIR = 'history';
const CACHE_DIR = 'cache';

const GITIGNORE_CONTENT = `# Ranvier API Explorer
history/
cache/
environments/prod.json
environments/staging.json
`;

export class CollectionStore {
    private readonly ranvierDir: string;
    private readonly collectionsDir: string;
    private readonly historyDir: string;
    private readonly cacheDir: string;

    constructor(private readonly workspaceRoot: string) {
        this.ranvierDir = path.join(workspaceRoot, RANVIER_DIR);
        this.collectionsDir = path.join(this.ranvierDir, COLLECTIONS_DIR);
        this.historyDir = path.join(this.ranvierDir, HISTORY_DIR);
        this.cacheDir = path.join(this.ranvierDir, CACHE_DIR);
    }

    get isInitialized(): boolean {
        return fs.existsSync(this.ranvierDir);
    }

    async init(): Promise<void> {
        await fs.promises.mkdir(this.collectionsDir, { recursive: true });
        await fs.promises.mkdir(this.historyDir, { recursive: true });
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
        await fs.promises.mkdir(path.join(this.ranvierDir, 'environments'), { recursive: true });
        await fs.promises.mkdir(path.join(this.ranvierDir, 'snapshots'), { recursive: true });

        const gitignorePath = path.join(this.ranvierDir, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            await fs.promises.writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf8');
        }
    }

    // ── Collections ──────────────────────────────────────────────

    async listCollections(): Promise<CollectionMeta[]> {
        if (!fs.existsSync(this.collectionsDir)) return [];

        const entries = await fs.promises.readdir(this.collectionsDir, { withFileTypes: true });
        const metas: CollectionMeta[] = [];

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            const filePath = path.join(this.collectionsDir, entry.name);
            try {
                const raw = await fs.promises.readFile(filePath, 'utf8');
                const parsed = JSON.parse(raw) as Collection;
                const stat = await fs.promises.stat(filePath);
                metas.push({
                    name: parsed.name || entry.name.replace(/\.json$/, ''),
                    requestCount: parsed.requests?.length ?? 0,
                    lastModified: stat.mtime.toISOString(),
                });
            } catch {
                // Skip malformed files
            }
        }

        return metas.sort((a, b) => a.name.localeCompare(b.name));
    }

    async loadCollection(name: string): Promise<Collection | null> {
        const filePath = this.collectionPath(name);
        if (!fs.existsSync(filePath)) return null;

        try {
            const raw = await fs.promises.readFile(filePath, 'utf8');
            return JSON.parse(raw) as Collection;
        } catch {
            return null;
        }
    }

    async saveCollection(collection: Collection): Promise<void> {
        await fs.promises.mkdir(this.collectionsDir, { recursive: true });
        collection.schema_version = SCHEMA_VERSION;
        const filePath = this.collectionPath(collection.name);
        await fs.promises.writeFile(filePath, JSON.stringify(collection, null, 2) + '\n', 'utf8');
    }

    async deleteCollection(name: string): Promise<boolean> {
        const filePath = this.collectionPath(name);
        if (!fs.existsSync(filePath)) return false;
        await fs.promises.unlink(filePath);
        return true;
    }

    async createCollection(name: string): Promise<Collection> {
        const collection: Collection = {
            schema_version: SCHEMA_VERSION,
            name,
            requests: [],
        };
        await this.saveCollection(collection);
        return collection;
    }

    // ── Request CRUD within a collection ─────────────────────────

    async saveRequest(collectionName: string, request: CollectionRequest): Promise<Collection | null> {
        const collection = await this.loadCollection(collectionName);
        if (!collection) return null;

        const index = collection.requests.findIndex(r => r.id === request.id);
        if (index >= 0) {
            collection.requests[index] = request;
        } else {
            collection.requests.push(request);
        }

        await this.saveCollection(collection);
        return collection;
    }

    async deleteRequest(collectionName: string, requestId: string): Promise<Collection | null> {
        const collection = await this.loadCollection(collectionName);
        if (!collection) return null;

        collection.requests = collection.requests.filter(r => r.id !== requestId);
        await this.saveCollection(collection);
        return collection;
    }

    async duplicateRequest(collectionName: string, requestId: string): Promise<CollectionRequest | null> {
        const collection = await this.loadCollection(collectionName);
        if (!collection) return null;

        const original = collection.requests.find(r => r.id === requestId);
        if (!original) return null;

        const duplicate: CollectionRequest = {
            ...original,
            id: generateId(),
            name: `${original.name} (copy)`,
        };
        collection.requests.push(duplicate);
        await this.saveCollection(collection);
        return duplicate;
    }

    async renameRequest(collectionName: string, requestId: string, newName: string): Promise<boolean> {
        const collection = await this.loadCollection(collectionName);
        if (!collection) return false;

        const request = collection.requests.find(r => r.id === requestId);
        if (!request) return false;

        request.name = newName;
        await this.saveCollection(collection);
        return true;
    }

    // ── Presets (M204) ─────────────────────────────────────────

    async savePreset(collectionName: string, requestId: string, preset: import('../shared/types').RequestPreset): Promise<boolean> {
        const collection = await this.loadCollection(collectionName);
        if (!collection) return false;
        const request = collection.requests.find(r => r.id === requestId);
        if (!request) return false;

        if (!request.presets) request.presets = [];
        const idx = request.presets.findIndex(p => p.name === preset.name);
        if (idx >= 0) {
            request.presets[idx] = preset;
        } else {
            request.presets.push(preset);
        }
        await this.saveCollection(collection);
        return true;
    }

    async deletePreset(collectionName: string, requestId: string, presetName: string): Promise<boolean> {
        const collection = await this.loadCollection(collectionName);
        if (!collection) return false;
        const request = collection.requests.find(r => r.id === requestId);
        if (!request?.presets) return false;

        request.presets = request.presets.filter(p => p.name !== presetName);
        await this.saveCollection(collection);
        return true;
    }

    getPresets(collection: import('../shared/types').Collection, requestId: string): import('../shared/types').RequestPreset[] {
        const request = collection.requests.find(r => r.id === requestId);
        return request?.presets ?? [];
    }

    // ── History ──────────────────────────────────────────────────

    async saveHistoryEntry(entry: HistoryEntry): Promise<void> {
        await fs.promises.mkdir(this.historyDir, { recursive: true });
        const filename = `${Date.now()}_${entry.requestId}.log.json`;
        const filePath = path.join(this.historyDir, filename);
        await fs.promises.writeFile(filePath, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    }

    async listHistory(limit = 100): Promise<HistoryEntry[]> {
        if (!fs.existsSync(this.historyDir)) return [];

        const entries = await fs.promises.readdir(this.historyDir, { withFileTypes: true });
        const logFiles = entries
            .filter(e => e.isFile() && e.name.endsWith('.log.json'))
            .map(e => e.name)
            .sort()
            .reverse()
            .slice(0, limit);

        const results: HistoryEntry[] = [];
        for (const filename of logFiles) {
            try {
                const raw = await fs.promises.readFile(path.join(this.historyDir, filename), 'utf8');
                results.push(JSON.parse(raw) as HistoryEntry);
            } catch {
                // Skip malformed files
            }
        }

        return results;
    }

    async clearHistory(): Promise<number> {
        if (!fs.existsSync(this.historyDir)) return 0;

        const entries = await fs.promises.readdir(this.historyDir, { withFileTypes: true });
        let count = 0;
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.log.json')) {
                await fs.promises.unlink(path.join(this.historyDir, entry.name));
                count++;
            }
        }
        return count;
    }

    async pruneHistory(maxEntries: number): Promise<number> {
        if (!fs.existsSync(this.historyDir)) return 0;

        const entries = await fs.promises.readdir(this.historyDir, { withFileTypes: true });
        const logFiles = entries
            .filter(e => e.isFile() && e.name.endsWith('.log.json'))
            .map(e => e.name)
            .sort()
            .reverse();

        if (logFiles.length <= maxEntries) return 0;

        const toDelete = logFiles.slice(maxEntries);
        for (const filename of toDelete) {
            await fs.promises.unlink(path.join(this.historyDir, filename));
        }
        return toDelete.length;
    }

    // ── Helpers ──────────────────────────────────────────────────

    private collectionPath(name: string): string {
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        return path.join(this.collectionsDir, `${safeName}.json`);
    }
}

function generateId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { EnvironmentConfig, EnvironmentMeta } from '../shared/types';

export class EnvironmentStore {
    private readonly envDir: string;

    constructor(workspaceRoot: string) {
        this.envDir = path.join(workspaceRoot, '.ranvier', 'environments');
    }

    get isAvailable(): boolean {
        try {
            // Sync check for directory existence
            return require('node:fs').existsSync(this.envDir);
        } catch {
            return false;
        }
    }

    async listEnvironments(): Promise<EnvironmentMeta[]> {
        try {
            const files = await fs.readdir(this.envDir);
            const envFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.example'));
            const metas: EnvironmentMeta[] = [];
            for (const file of envFiles) {
                const filePath = path.join(this.envDir, file);
                const stat = await fs.stat(filePath);
                metas.push({
                    name: file.replace(/\.json$/, ''),
                    lastModified: stat.mtime.toISOString(),
                });
            }
            return metas.sort((a, b) => a.name.localeCompare(b.name));
        } catch {
            return [];
        }
    }

    async loadEnvironment(name: string): Promise<EnvironmentConfig | null> {
        try {
            const filePath = path.join(this.envDir, `${name}.json`);
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            return {
                name: data.name ?? name,
                variables: data.variables ?? {},
            };
        } catch {
            return null;
        }
    }

    async saveEnvironment(env: EnvironmentConfig): Promise<void> {
        await fs.mkdir(this.envDir, { recursive: true });
        const filePath = path.join(this.envDir, `${env.name}.json`);
        await fs.writeFile(filePath, JSON.stringify(env, null, 2), 'utf-8');
    }

    async deleteEnvironment(name: string): Promise<void> {
        try {
            const filePath = path.join(this.envDir, `${name}.json`);
            await fs.unlink(filePath);
        } catch {
            // ignore
        }
    }

    async createExampleTemplate(name: string, variables: Record<string, string>): Promise<void> {
        const examplePath = path.join(this.envDir, `${name}.example`);
        const template: Record<string, string> = {};
        for (const key of Object.keys(variables)) {
            template[key] = '';
        }
        const content = JSON.stringify({ name, variables: template }, null, 2);
        await fs.writeFile(examplePath, content, 'utf-8');
    }
}

const SECRET_PATTERNS = [/token/i, /key/i, /secret/i, /password/i, /credential/i, /auth/i];

export function isSecretVariable(name: string): boolean {
    return SECRET_PATTERNS.some(p => p.test(name));
}

export function maskSecretValue(value: string): string {
    if (value.length <= 4) return '***';
    return value.slice(0, 2) + '***' + value.slice(-2);
}

export function interpolateVariables(
    template: string,
    variables: Record<string, string>,
): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
        return variables[key] ?? `{{${key}}}`;
    });
}

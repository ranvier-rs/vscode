import * as vscode from 'vscode';
import { EnvironmentStore, interpolateVariables, isSecretVariable, maskSecretValue } from './core/environment-store';
import type { EnvironmentConfig, EnvironmentMeta } from './shared/types';

// ── Environment Manager ───────────────────────────────────────────
//
// Manages Ranvier environments (dev, staging, prod) stored in
// `.ranvier/environments/` with variable substitution support:
//   {{env.BASE_URL}}, {{secret.API_KEY}}
//
// Provides a status bar item for quick environment switching and a
// QuickPick-based environment selector command.

export class EnvironmentManager implements vscode.Disposable {
    private _statusBarItem: vscode.StatusBarItem;
    private _environmentStore?: EnvironmentStore;
    private _activeEnvironment?: string;
    private _environmentVariables: Record<string, string> = {};
    private _disposables: vscode.Disposable[] = [];
    private _onDidChangeEnvironment = new vscode.EventEmitter<EnvironmentChangeEvent>();

    /** Fires whenever the active environment changes. */
    public readonly onDidChangeEnvironment = this._onDidChangeEnvironment.event;

    constructor(
        private readonly _workspaceRoot?: string,
    ) {
        // Create status bar item (right-aligned, priority 100)
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this._statusBarItem.command = 'ranvier.switchEnvironment';
        this._statusBarItem.tooltip = 'Ranvier: Switch Environment';
        this._updateStatusBar();
        this._statusBarItem.show();
        this._disposables.push(this._statusBarItem);

        // Watch for environment file changes
        if (this._workspaceRoot) {
            const envPattern = new vscode.RelativePattern(
                this._workspaceRoot,
                '.ranvier/environments/*.json',
            );
            const watcher = vscode.workspace.createFileSystemWatcher(envPattern);
            watcher.onDidCreate(() => this._onEnvFilesChanged());
            watcher.onDidChange(() => this._onEnvFilesChanged());
            watcher.onDidDelete(() => this._onEnvFilesChanged());
            this._disposables.push(watcher);
        }

        // Restore last active environment from workspace state
        this._restoreDefaultEnvironment();
    }

    // ── Public API ────────────────────────────────────────────────

    /** Currently active environment name, or undefined. */
    get activeEnvironment(): string | undefined {
        return this._activeEnvironment;
    }

    /** Currently loaded environment variables. */
    get variables(): Record<string, string> {
        return { ...this._environmentVariables };
    }

    /**
     * Interpolate `{{var}}` placeholders in a string using the active
     * environment's variables. Supports both `{{VAR_NAME}}` short form
     * and `{{env.VAR_NAME}}` / `{{secret.VAR_NAME}}` prefixed forms.
     */
    interpolate(template: string): string {
        if (!template || Object.keys(this._environmentVariables).length === 0) {
            return template;
        }

        // First pass: resolve {{env.KEY}} and {{secret.KEY}} prefixed forms
        let result = template.replace(
            /\{\{(?:env|secret)\.(\w+)\}\}/g,
            (_match, key: string) => {
                return this._environmentVariables[key] ?? `{{${key}}}`;
            },
        );

        // Second pass: resolve plain {{KEY}} forms
        result = interpolateVariables(result, this._environmentVariables);

        return result;
    }

    /**
     * Show a QuickPick to switch the active environment. Called by
     * the `ranvier.switchEnvironment` command.
     */
    async showEnvironmentPicker(): Promise<void> {
        const envStore = this._ensureStore();
        if (!envStore) {
            vscode.window.showWarningMessage(
                'No workspace folder open. Open a folder with a .ranvier/environments/ directory.',
            );
            return;
        }

        const environments = await envStore.listEnvironments();

        const items: (vscode.QuickPickItem & { envName?: string })[] = [
            {
                label: '$(clear-all) No Environment',
                description: 'Clear active environment',
                envName: '',
            },
            ...environments.map((env) => ({
                label: env.name === this._activeEnvironment
                    ? `$(check) ${env.name}`
                    : `$(symbol-variable) ${env.name}`,
                description: env.name === this._activeEnvironment ? 'active' : undefined,
                detail: `Last modified: ${new Date(env.lastModified).toLocaleString()}`,
                envName: env.name,
            })),
            { kind: vscode.QuickPickItemKind.Separator, label: '' },
            {
                label: '$(add) Create New Environment...',
                envName: '__create__',
            },
        ];

        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an environment',
            title: 'Ranvier: Switch Environment',
        });

        if (!pick || pick.envName === undefined) return;

        if (pick.envName === '__create__') {
            await this._createNewEnvironment(envStore);
            return;
        }

        if (pick.envName === '') {
            await this._deactivateEnvironment();
            return;
        }

        await this.switchTo(pick.envName);
    }

    /**
     * Programmatically switch to a named environment.
     */
    async switchTo(name: string): Promise<void> {
        const envStore = this._ensureStore();
        if (!envStore) return;

        const env = await envStore.loadEnvironment(name);
        if (!env) {
            vscode.window.showWarningMessage(`Environment "${name}" not found.`);
            return;
        }

        this._activeEnvironment = name;
        this._environmentVariables = env.variables;
        this._updateStatusBar();
        this._persistActiveEnvironment(name);

        this._onDidChangeEnvironment.fire({
            name,
            variables: { ...env.variables },
        });

        vscode.window.showInformationMessage(
            `Ranvier: Switched to environment "${name}" (${Object.keys(env.variables).length} variables).`,
        );
    }

    /**
     * Get a summary of the active environment for display purposes.
     * Secret variables are masked.
     */
    getActiveSummary(): EnvironmentSummary | null {
        if (!this._activeEnvironment) return null;

        const entries = Object.entries(this._environmentVariables).map(
            ([key, value]) => ({
                key,
                value: isSecretVariable(key) ? maskSecretValue(value) : value,
                isSecret: isSecretVariable(key),
            }),
        );

        return {
            name: this._activeEnvironment,
            variableCount: entries.length,
            entries,
        };
    }

    dispose(): void {
        this._onDidChangeEnvironment.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }

    // ── Private helpers ───────────────────────────────────────────

    private _ensureStore(): EnvironmentStore | undefined {
        if (!this._environmentStore && this._workspaceRoot) {
            this._environmentStore = new EnvironmentStore(this._workspaceRoot);
        }
        return this._environmentStore;
    }

    private _updateStatusBar(): void {
        if (this._activeEnvironment) {
            this._statusBarItem.text = `$(server-environment) ${this._activeEnvironment}`;
            this._statusBarItem.backgroundColor = undefined;
        } else {
            this._statusBarItem.text = '$(server-environment) No Env';
            this._statusBarItem.backgroundColor = undefined;
        }
    }

    private async _deactivateEnvironment(): Promise<void> {
        this._activeEnvironment = undefined;
        this._environmentVariables = {};
        this._updateStatusBar();
        this._persistActiveEnvironment('');

        this._onDidChangeEnvironment.fire({
            name: undefined,
            variables: {},
        });

        vscode.window.showInformationMessage('Ranvier: Environment deactivated.');
    }

    private async _createNewEnvironment(envStore: EnvironmentStore): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter environment name (e.g., dev, staging, prod)',
            placeHolder: 'Environment name',
            validateInput: (value) => {
                if (!value.trim()) return 'Name is required.';
                if (!/^[\w-]+$/.test(value)) return 'Name must contain only letters, numbers, hyphens, and underscores.';
                return null;
            },
        });

        if (!name) return;

        const env: EnvironmentConfig = {
            name: name.trim(),
            variables: {
                BASE_URL: 'http://localhost:3000',
            },
        };

        await envStore.saveEnvironment(env);
        await this.switchTo(env.name);

        vscode.window.showInformationMessage(
            `Ranvier: Created environment "${env.name}". Edit .ranvier/environments/${env.name}.json to add variables.`,
        );
    }

    private _persistActiveEnvironment(name: string): void {
        const config = vscode.workspace.getConfiguration('ranvier');
        void config.update(
            'apiExplorer.defaultEnvironment',
            name || undefined,
            vscode.ConfigurationTarget.Workspace,
        );
    }

    private async _restoreDefaultEnvironment(): Promise<void> {
        const config = vscode.workspace.getConfiguration('ranvier');
        const defaultEnv = config.get<string>('apiExplorer.defaultEnvironment', '');
        if (defaultEnv) {
            // Silently restore without showing messages
            const envStore = this._ensureStore();
            if (!envStore) return;
            const env = await envStore.loadEnvironment(defaultEnv);
            if (env) {
                this._activeEnvironment = defaultEnv;
                this._environmentVariables = env.variables;
                this._updateStatusBar();
            }
        }
    }

    private _onEnvFilesChanged(): void {
        // If the active environment file changed, reload it
        if (this._activeEnvironment) {
            void this._reloadActiveEnvironment();
        }
    }

    private async _reloadActiveEnvironment(): Promise<void> {
        if (!this._activeEnvironment) return;
        const envStore = this._ensureStore();
        if (!envStore) return;

        const env = await envStore.loadEnvironment(this._activeEnvironment);
        if (env) {
            this._environmentVariables = env.variables;
            this._onDidChangeEnvironment.fire({
                name: this._activeEnvironment,
                variables: { ...env.variables },
            });
        } else {
            // Environment file was deleted
            await this._deactivateEnvironment();
        }
    }
}

// ── Types ─────────────────────────────────────────────────────────

export type EnvironmentChangeEvent = {
    name: string | undefined;
    variables: Record<string, string>;
};

export type EnvironmentSummary = {
    name: string;
    variableCount: number;
    entries: {
        key: string;
        value: string;
        isSecret: boolean;
    }[];
};

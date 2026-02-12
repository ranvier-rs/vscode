/**
 * VSCode Theme Integration
 * 
 * Maps semantic meanings to VSCode CSS variables.
 * These variables are injected by VSCode into the webview context.
 */

export const theme = {
    // Semantic Colors
    background: 'var(--vscode-editor-background)',
    foreground: 'var(--vscode-editor-foreground)',

    // Node Colors (Severity)
    node: {
        error: {
            border: 'var(--vscode-testing-iconError)',
            background: 'var(--vscode-inputValidation-errorBackground)',
            badge: 'var(--vscode-testing-iconError)'
        },
        warning: {
            border: 'var(--vscode-problemsWarningIcon-foreground)',
            background: 'var(--vscode-inputValidation-warningBackground)',
            badge: 'var(--vscode-problemsWarningIcon-foreground)'
        },
        info: {
            border: 'var(--vscode-problemsInfoIcon-foreground)',
            background: 'var(--vscode-inputValidation-infoBackground)',
            badge: 'var(--vscode-problemsInfoIcon-foreground)'
        },
        none: {
            border: 'var(--vscode-panel-border)',
            background: 'var(--vscode-editor-background)', // Use editor background for neutral
            badge: 'var(--vscode-disabledForeground)'
        }
    },

    // Interactions
    focusBorder: 'var(--vscode-focusBorder)',
    selectionBackground: 'var(--vscode-list-activeSelectionBackground)',
    hoverBackground: 'var(--vscode-list-hoverBackground)',

    // UI Elements
    button: {
        background: 'var(--vscode-button-background)',
        foreground: 'var(--vscode-button-foreground)',
        hoverBackground: 'var(--vscode-button-hoverBackground)'
    },
    toolbar: {
        background: 'var(--vscode-editorWidget-background)', // Better than general background for floating toolbars
        border: 'var(--vscode-editorWidget-border)'
    }
};

export type Severity = 'error' | 'warning' | 'info' | 'none';

export function getNodeTheme(severity: Severity) {
    return theme.node[severity] || theme.node.none;
}

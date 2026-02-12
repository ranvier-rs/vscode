import * as vscode from 'vscode';
import { getToolboxWebviewHtml } from './templates/toolbox-webview';

export class RanvierToolboxProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'ready':
                    {
                        // Handle view ready
                        break;
                    }
                case 'insert-snippet':
                    {
                        const snippet = data.payload.snippet;
                        const editor = vscode.window.activeTextEditor;
                        if (editor) {
                            editor.insertSnippet(new vscode.SnippetString(snippet));
                        }
                        break;
                    }
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.js'));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.css'));
        const nonce = getNonce();

        return getToolboxWebviewHtml({
            webview,
            htmlLang: vscode.env.language.toLowerCase().startsWith('ko') ? 'ko' : 'en',
            nonce,
            cssUri,
            jsUri,
            extensionUri: this._extensionUri,
            // nonce passed above
        } as any); // Type cast if needed, or fix TemplateData interface
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

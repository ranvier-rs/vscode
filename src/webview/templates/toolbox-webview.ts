import { MainTemplateData } from './template-types';

export function getToolboxWebviewHtml(data: MainTemplateData): string {
    const { webview, htmlLang, nonce, cssUri, jsUri } = data;

    return `<!doctype html>
<html lang="${htmlLang}">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${cssUri}" />
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}">
      window.ranvierViewType = 'toolbox';
    </script>
    <script nonce="${nonce}" src="${jsUri}"></script>
  </body>
</html>`;
}

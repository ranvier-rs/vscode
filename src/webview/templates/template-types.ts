import * as vscode from 'vscode';
import { TranslationDictionary } from '../i18n-data';

export interface BaseTemplateData {
    webview: vscode.Webview;
    extensionUri: vscode.Uri;
    nonce: string;
}

export interface MainTemplateData extends BaseTemplateData {
    htmlLang: string;
    cssUri: vscode.Uri;
    jsUri: vscode.Uri;
}

export interface SidebarTemplateData extends BaseTemplateData {
    htmlLang: string;
    initialTranslations: TranslationDictionary;
}

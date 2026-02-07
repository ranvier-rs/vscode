import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizePath } from './schematic';

export type ResolveSourceResult =
  | {
      ok: true;
      filePath: string;
      line: number;
    }
  | {
      ok: false;
      reason: 'workspace-not-open' | 'missing-source-file' | 'file-not-found';
      message: string;
    };

export function resolveSourceFilePath(
  workspaceFolder: string | undefined,
  relativePath: string | undefined,
  line?: number
): ResolveSourceResult {
  if (!workspaceFolder) {
    return {
      ok: false,
      reason: 'workspace-not-open',
      message: 'Ranvier source jump failed: open a workspace folder first.'
    };
  }

  if (!relativePath || relativePath.trim().length === 0) {
    return {
      ok: false,
      reason: 'missing-source-file',
      message: 'Ranvier source jump failed: node has no source file mapping.'
    };
  }

  const normalized = normalizePath(relativePath);
  const candidates = [
    path.resolve(workspaceFolder, relativePath),
    path.resolve(workspaceFolder, normalized)
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    return {
      ok: false,
      reason: 'file-not-found',
      message: `Ranvier source jump failed: file not found in workspace (${normalized}).`
    };
  }

  return {
    ok: true,
    filePath,
    line: Math.max(1, line ?? 1)
  };
}

import { relative, sep } from 'node:path';

export function formatPreviewRootLabel(rootPath: string, cwd = process.cwd()): string {
  const relativePath = relative(cwd, rootPath);
  return normalizePath(relativePath || '.');
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

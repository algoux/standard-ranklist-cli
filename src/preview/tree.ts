import { readdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { PreviewGitStatus, PreviewGitStatusCode } from '../git/status.js';
import type { PreviewTreeEntry } from '../rendering/template.js';
import { CliError } from '../utils/errors.js';

export interface BuildPreviewTreeOptions {
  gitStatuses?: Map<string, PreviewGitStatus>;
  diffPaths?: string[];
}

export async function buildPreviewTree(
  rootPath: string,
  options: BuildPreviewTreeOptions = {},
): Promise<{ entries: PreviewTreeEntry[] }> {
  const entries = options.diffPaths
    ? await buildDiffTreeEntries(rootPath, options)
    : await readDirectoryEntries(rootPath, rootPath, options);
  return { entries };
}

export async function findFirstRanklistPath(
  rootPath: string,
  options: BuildPreviewTreeOptions = {},
): Promise<string | null> {
  const tree = await buildPreviewTree(rootPath, options);
  return findFirstTreeRanklistPath(tree.entries);
}

export function findFirstTreeRanklistPath(entries: PreviewTreeEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type === 'file' && !entry.disabled) {
      return entry.path;
    }
    const childPath = findFirstTreeRanklistPath(entry.children ?? []);
    if (childPath) {
      return childPath;
    }
  }
  return null;
}

export function resolvePreviewFilePath(rootPath: string, relativePath: string): string {
  const absolute = resolve(rootPath, relativePath);
  const relativeToRoot = relative(rootPath, absolute);
  if (relativeToRoot === '' || relativeToRoot.startsWith('..') || relativeToRoot.includes(`..${sep}`)) {
    throw new CliError(`Requested path "${relativePath}" is outside preview root.`, 403);
  }
  return absolute;
}

async function readDirectoryEntries(
  rootPath: string,
  directoryPath: string,
  options: BuildPreviewTreeOptions,
): Promise<PreviewTreeEntry[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const treeEntries: PreviewTreeEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const absolutePath = resolve(directoryPath, entry.name);
    const relativePath = normalizePath(relative(rootPath, absolutePath));

    if (entry.isDirectory()) {
      const children = await readDirectoryEntries(rootPath, absolutePath, options);
      treeEntries.push({
        type: 'directory',
        name: entry.name,
        path: relativePath,
        children,
        gitStatus: aggregateGitStatus(children),
      });
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.srk.json')) {
      treeEntries.push({
        type: 'file',
        name: entry.name,
        path: relativePath,
        gitStatus: options.gitStatuses?.get(relativePath),
      });
    }
  }

  return treeEntries.sort(compareTreeEntries);
}

async function buildDiffTreeEntries(
  rootPath: string,
  options: BuildPreviewTreeOptions,
): Promise<PreviewTreeEntry[]> {
  const rootEntries: PreviewTreeEntry[] = [];
  const diffPaths = [...new Set((options.diffPaths ?? []).map(normalizePath))]
    .filter((path) => path.endsWith('.srk.json'))
    .sort();

  for (const diffPath of diffPaths) {
    const absolutePath = resolvePreviewFilePath(rootPath, diffPath);
    const parts = diffPath.split('/').filter(Boolean);
    if (!parts.length) {
      continue;
    }

    let children = rootEntries;
    let currentPath = '';
    for (const part of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let directory = children.find((entry) => entry.type === 'directory' && entry.path === currentPath);
      if (!directory) {
        directory = {
          type: 'directory',
          name: part,
          path: currentPath,
          children: [],
        };
        children.push(directory);
      }
      children = directory.children ?? [];
    }

    const name = parts[parts.length - 1];
    const gitStatus = options.gitStatuses?.get(diffPath);
    children.push({
      type: 'file',
      name,
      path: diffPath,
      gitStatus,
      disabled: gitStatus?.code === 'D' || !(await isFile(absolutePath)),
    });
  }

  finalizeTreeEntries(rootEntries);
  return rootEntries;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function finalizeTreeEntries(entries: PreviewTreeEntry[]): void {
  for (const entry of entries) {
    if (entry.type === 'directory') {
      finalizeTreeEntries(entry.children ?? []);
      entry.gitStatus = aggregateGitStatus(entry.children ?? []);
    }
  }
  entries.sort(compareTreeEntries);
}

function aggregateGitStatus(entries: PreviewTreeEntry[]): PreviewGitStatus | undefined {
  let selected: PreviewGitStatus | undefined;
  for (const entry of entries) {
    if (!entry.gitStatus) {
      continue;
    }
    if (!selected || compareGitStatusPriority(entry.gitStatus.code, selected.code) < 0) {
      selected = entry.gitStatus;
    }
  }
  return selected;
}

function compareGitStatusPriority(left: PreviewGitStatusCode, right: PreviewGitStatusCode): number {
  const priority: PreviewGitStatusCode[] = ['U', 'A', 'M', 'R', 'D'];
  return priority.indexOf(left) - priority.indexOf(right);
}

function compareTreeEntries(left: PreviewTreeEntry, right: PreviewTreeEntry): number {
  if (left.type !== right.type) {
    return left.type === 'file' ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

export async function assertPreviewRanklistFile(path: string): Promise<void> {
  if (!(await isFile(path))) {
    throw new CliError(`Requested ranklist "${path}" is not a file.`, 404);
  }
}

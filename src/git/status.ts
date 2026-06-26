import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { CliError, getErrorMessage } from '../utils/errors.js';

const execFileAsync = promisify(execFile);
const maxGitBlobStderrLength = 8 * 1024;

export type PreviewGitStatusCode = 'U' | 'A' | 'M' | 'R' | 'D';
export type PreviewGitStatusTone = 'green' | 'blue' | 'red';

export interface PreviewGitStatus {
  code: PreviewGitStatusCode;
  tone: PreviewGitStatusTone;
}

export interface PreviewGitDiffRefs {
  base: string;
  head: string;
}

export interface PreviewGitContext {
  mode: 'worktree' | 'diff';
  summaryLabel: string | null;
}

export interface PreviewGitState extends PreviewGitContext {
  repoRoot: string;
  statuses: Map<string, PreviewGitStatus>;
  diffPaths: string[] | null;
  watchPaths: string[];
}

export interface PreviewGitCommitTarget {
  repoRoot: string;
  previewRoot: string;
  commit: string;
}

export async function collectPreviewGitState(
  previewRoot: string,
  diffRefs?: PreviewGitDiffRefs,
): Promise<PreviewGitState | null> {
  const normalizedPreviewRoot = await normalizeExistingPath(previewRoot);
  const repoRoot = await resolveRepoRoot(normalizedPreviewRoot, Boolean(diffRefs));
  if (!repoRoot) {
    return null;
  }

  const previewPathspec = toGitPathspec(relative(repoRoot, normalizedPreviewRoot));
  const watchPaths = await resolveGitWatchPaths(normalizedPreviewRoot);

  if (diffRefs) {
    const repoStatuses = await readDiffStatuses(repoRoot, previewPathspec, diffRefs);
    const statuses = mapStatusesToPreviewRoot(repoStatuses, repoRoot, normalizedPreviewRoot);
    return {
      repoRoot,
      mode: 'diff',
      summaryLabel: `Changes: ${diffRefs.base}...${diffRefs.head}`,
      statuses,
      diffPaths: [...statuses.keys()],
      watchPaths,
    };
  }

  const repoStatuses = await readWorktreeStatuses(repoRoot, previewPathspec);
  return {
    repoRoot,
    mode: 'worktree',
    summaryLabel: null,
    statuses: mapStatusesToPreviewRoot(repoStatuses, repoRoot, normalizedPreviewRoot),
    diffPaths: null,
    watchPaths,
  };
}

export async function resolvePreviewGitCommit(previewRoot: string, ref: string): Promise<PreviewGitCommitTarget> {
  const normalizedPreviewRoot = await normalizeExistingPath(previewRoot);
  const repoRoot = await resolveRepoRoot(normalizedPreviewRoot, true);
  if (!repoRoot) {
    throw new CliError(`Unable to resolve git repository for render diff.`);
  }
  const commit = await runGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return {
    repoRoot,
    previewRoot: normalizedPreviewRoot,
    commit,
  };
}

export async function writePreviewGitFileAtCommit(
  target: PreviewGitCommitTarget,
  previewRelativePath: string,
  outputPath: string,
): Promise<void> {
  const repoRelativePath = toRepoRelativePath(target.repoRoot, target.previewRoot, previewRelativePath);
  let stderr = '';
  let stderrTruncated = false;

  const child = spawn('git', ['-C', target.repoRoot, 'show', `${target.commit}:${repoRelativePath}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!child.stdout || !child.stderr) {
    child.kill();
    throw new CliError(`Unable to read "${previewRelativePath}" from git commit ${target.commit}: git stdout unavailable`);
  }

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length >= maxGitBlobStderrLength) {
      stderrTruncated = true;
      return;
    }
    const remaining = maxGitBlobStderrLength - stderr.length;
    stderr += chunk.slice(0, remaining);
    stderrTruncated ||= chunk.length > remaining;
  });

  const streamResult = pipeline(child.stdout, createWriteStream(outputPath));
  const exitResult = new Promise<void>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolveExit();
        return;
      }

      const stderrMessage = formatCollectedGitStderr(stderr, stderrTruncated);
      rejectExit(new Error(stderrMessage || formatGitExitStatus(code, signal)));
    });
  });

  const results = await Promise.allSettled([streamResult, exitResult]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw new CliError(
      `Unable to read "${previewRelativePath}" from git commit ${target.commit}: ${getErrorMessage(failure.reason)}`,
    );
  }
}

export function parseGitStatusPorcelainZ(output: string): Map<string, PreviewGitStatus> {
  const fields = output.split('\0').filter(Boolean);
  const statuses = new Map<string, PreviewGitStatus>();

  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (record.length < 4) {
      continue;
    }

    const xy = record.slice(0, 2);
    const path = normalizeGitPath(record.slice(3));
    const code = toPreviewStatusCode(xy);
    if (!path || !code) {
      continue;
    }

    statuses.set(path, createPreviewGitStatus(code));
    if (xy.includes('R') || xy.includes('C')) {
      index += 1;
    }
  }

  return statuses;
}

export function parseGitDiffNameStatusZ(output: string): Map<string, PreviewGitStatus> {
  const fields = output.split('\0').filter(Boolean);
  const statuses = new Map<string, PreviewGitStatus>();

  for (let index = 0; index < fields.length; index += 1) {
    const rawStatus = fields[index];
    const kind = rawStatus[0];
    const code = toPreviewDiffStatusCode(kind);
    if (!code) {
      continue;
    }

    let path: string | undefined;
    if (kind === 'R' || kind === 'C') {
      index += 2;
      path = fields[index];
    } else {
      index += 1;
      path = fields[index];
    }

    const normalizedPath = normalizeGitPath(path ?? '');
    if (normalizedPath) {
      statuses.set(normalizedPath, createPreviewGitStatus(code));
    }
  }

  return statuses;
}

function toPreviewStatusCode(xy: string): PreviewGitStatusCode | null {
  if (xy === '??' || xy.includes('U')) {
    return 'U';
  }
  if (xy.includes('A') || xy.includes('C')) {
    return 'A';
  }
  if (xy.includes('R')) {
    return 'R';
  }
  if (xy.includes('M')) {
    return 'M';
  }
  if (xy.includes('D')) {
    return 'D';
  }
  return null;
}

function toPreviewDiffStatusCode(kind: string | undefined): PreviewGitStatusCode | null {
  switch (kind) {
    case 'A':
      return 'A';
    case 'C':
      return 'A';
    case 'M':
      return 'M';
    case 'R':
      return 'R';
    case 'D':
      return 'D';
    default:
      return null;
  }
}

function createPreviewGitStatus(code: PreviewGitStatusCode): PreviewGitStatus {
  if (code === 'D') {
    return { code, tone: 'red' };
  }
  if (code === 'M' || code === 'R') {
    return { code, tone: 'blue' };
  }
  return { code, tone: 'green' };
}

async function resolveRepoRoot(previewRoot: string, required: boolean): Promise<string | null> {
  try {
    return normalizeAbsolutePath(await runGit(previewRoot, ['rev-parse', '--show-toplevel']));
  } catch (error) {
    if (!required) {
      return null;
    }
    throw new CliError(`Unable to resolve git repository for preview diff: ${getErrorMessage(error)}`);
  }
}

async function readWorktreeStatuses(repoRoot: string, previewPathspec: string): Promise<Map<string, PreviewGitStatus>> {
  try {
    const output = await runGit(repoRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      previewPathspec,
    ]);
    return parseGitStatusPorcelainZ(output);
  } catch {
    return new Map();
  }
}

async function readDiffStatuses(
  repoRoot: string,
  previewPathspec: string,
  diffRefs: PreviewGitDiffRefs,
): Promise<Map<string, PreviewGitStatus>> {
  try {
    const output = await runGit(repoRoot, [
      'diff',
      '--name-status',
      '-z',
      '--diff-filter=ACMRTD',
      `${diffRefs.base}...${diffRefs.head}`,
      '--',
      previewPathspec,
    ]);
    return parseGitDiffNameStatusZ(output);
  } catch (error) {
    throw new CliError(
      `Unable to read git diff ${diffRefs.base}...${diffRefs.head}: ${getErrorMessage(error)}`,
    );
  }
}

function mapStatusesToPreviewRoot(
  statuses: Map<string, PreviewGitStatus>,
  repoRoot: string,
  previewRoot: string,
): Map<string, PreviewGitStatus> {
  const previewRootRelativeToRepo = normalizeGitPath(relative(repoRoot, previewRoot));
  const mapped = new Map<string, PreviewGitStatus>();

  for (const [repoRelativePath, status] of statuses) {
    const previewRelativePath = toPreviewRelativePath(repoRelativePath, previewRootRelativeToRepo);
    if (previewRelativePath) {
      mapped.set(previewRelativePath, status);
    }
  }

  return mapped;
}

function toPreviewRelativePath(repoRelativePath: string, previewRootRelativeToRepo: string): string | null {
  if (!previewRootRelativeToRepo || previewRootRelativeToRepo === '.') {
    return repoRelativePath;
  }

  if (repoRelativePath === previewRootRelativeToRepo) {
    return '';
  }

  const prefix = `${previewRootRelativeToRepo}/`;
  return repoRelativePath.startsWith(prefix) ? repoRelativePath.slice(prefix.length) : null;
}

function toRepoRelativePath(repoRoot: string, previewRoot: string, previewRelativePath: string): string {
  const absolutePath = resolve(previewRoot, previewRelativePath);
  const relativeToPreviewRoot = relative(previewRoot, absolutePath);
  if (
    relativeToPreviewRoot === '' ||
    relativeToPreviewRoot.startsWith('..') ||
    relativeToPreviewRoot.includes(`..${sep}`)
  ) {
    throw new CliError(`Requested path "${previewRelativePath}" is outside preview root.`, 403);
  }
  return normalizeGitPath(relative(repoRoot, absolutePath));
}

async function resolveGitWatchPaths(previewRoot: string): Promise<string[]> {
  const candidates = await Promise.all([
    resolveGitPath(previewRoot, 'index'),
    resolveGitPath(previewRoot, 'HEAD'),
  ]);
  const paths: string[] = [];
  for (const path of candidates) {
    if (path && (await pathExists(path))) {
      paths.push(path);
    }
  }
  return paths;
}

async function resolveGitPath(previewRoot: string, name: string): Promise<string | null> {
  try {
    const path = await runGit(previewRoot, ['rev-parse', '--git-path', name]);
    return normalizeAbsolutePath(isAbsolute(path) ? path : resolve(previewRoot, path));
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function normalizeExistingPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  return (await runGitRaw(cwd, args)).replace(/\r?\n$/u, '');
}

async function runGitRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return String(stdout);
}

function formatCollectedGitStderr(stderr: string, truncated: boolean): string {
  const message = stderr.trim();
  if (!message) {
    return '';
  }
  return truncated ? `${message}\n[stderr truncated]` : message;
}

function formatGitExitStatus(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    return `git show exited with signal ${signal}`;
  }
  return `git show exited with code ${code ?? 'unknown'}`;
}

function toGitPathspec(path: string): string {
  const normalized = normalizeGitPath(path);
  return normalized || '.';
}

function normalizeAbsolutePath(path: string): string {
  return resolve(path);
}

function normalizeGitPath(path: string): string {
  return path.split(sep).join('/').replace(/^\.\//u, '');
}

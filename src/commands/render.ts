import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Command } from 'commander';
import {
  collectPreviewGitState,
  resolvePreviewGitCommit,
  type PreviewGitCommitTarget,
  type PreviewGitDiffRefs,
  writePreviewGitFileAtCommit,
} from '../git/status.js';
import { formatPreviewRootLabel } from '../preview/root-label.js';
import {
  buildPreviewTree,
  findFirstTreeRanklistPath,
  resolvePreviewFilePath,
  type BuildPreviewTreeOptions,
} from '../preview/tree.js';
import { DEFAULT_SRK_ASSET_BASE, inferRanklistId } from '../rendering/assets.js';
import { renderPreviewHtml, type PreviewPrContext, type PreviewTreeEntry } from '../rendering/template.js';
import { CliError, getErrorMessage } from '../utils/errors.js';
import { readJsonFile } from '../utils/files.js';

interface RenderOptions {
  output?: string;
  srkAssetBase: string;
  gitDiffBase?: string;
  gitDiffHead?: string;
  prUrl?: string;
  staticDataRootUrl?: string;
}

export function createRenderCommand(): Command {
  const command = new Command('render');

  command
    .description('render a Standard Ranklist JSON file or directory to standalone HTML')
    .argument('<path>', 'ranklist JSON file or directory to render')
    .option('-o, --output <path>', 'write rendered HTML to a file, or directory output for directory render')
    .option('--srk-asset-base <url>', 'base URL for relative SRK assets', DEFAULT_SRK_ASSET_BASE)
    .option('--git-diff-base <ref>', 'render only SRK files changed in the git diff from this base ref')
    .option('--git-diff-head <ref>', 'git diff head ref for --git-diff-base')
    .option('--pr-url <url>', 'mark directory diff output as a PR review build')
    .option('--static-data-root-url <url>', 'load static directory render JSON from URL root instead of writing files')
    .action(async (path: string, options: RenderOptions) => {
      await runRender(path, options);
    });

  return command;
}

async function runRender(inputPath: string, options: RenderOptions): Promise<void> {
  const absoluteInputPath = resolve(process.cwd(), inputPath);
  const inputStat = await stat(absoluteInputPath).catch((error: unknown) => {
    throw new CliError(`Unable to inspect render path "${absoluteInputPath}": ${getErrorMessage(error)}`);
  });

  if (inputStat.isFile()) {
    await renderSingleFile(absoluteInputPath, options);
    return;
  }

  if (inputStat.isDirectory()) {
    await renderDirectory(absoluteInputPath, options);
    return;
  }

  throw new CliError(`Render path "${absoluteInputPath}" must be a file or directory.`);
}

async function renderSingleFile(absoluteRanklistPath: string, options: RenderOptions): Promise<void> {
  if (options.gitDiffBase || options.gitDiffHead) {
    throw new CliError('Git diff render is only supported for directory render paths.');
  }
  if (options.prUrl) {
    throw new CliError('PR review render is only supported for directory render paths.');
  }

  const ranklist = await readJsonFile(absoluteRanklistPath, 'ranklist');
  const html = await renderPreviewHtml({
    mode: 'single',
    dataSource: 'inline',
    dataRoot: null,
    ranklist,
    id: inferRanklistId(absoluteRanklistPath),
    assetBase: options.srkAssetBase,
    selectedPath: absoluteRanklistPath,
    tree: null,
    watch: false,
    rootLabel: null,
    gitContext: null,
    pageTitle: null,
    prContext: null,
  });

  if (options.output) {
    await writeFile(options.output, html, 'utf8');
    return;
  }

  process.stdout.write(html);
}

async function renderDirectory(inputPath: string, options: RenderOptions): Promise<void> {
  if (!options.output) {
    throw new CliError('Directory render requires --output to specify an output directory.');
  }
  if (options.gitDiffHead && !options.gitDiffBase) {
    throw new CliError('--git-diff-head requires --git-diff-base.');
  }
  if (options.prUrl && !options.gitDiffBase) {
    throw new CliError('--pr-url requires --git-diff-base for PR review directory render.');
  }

  const outputDir = resolve(process.cwd(), options.output);
  const gitDiffRefs = resolveGitDiffRefs(options);
  const gitState = await collectPreviewGitState(inputPath, gitDiffRefs ?? undefined);
  const tree = await buildPreviewTree(inputPath, toBuildPreviewTreeOptions(gitState));
  if (gitDiffRefs) {
    enableGitDiffRenderableFiles(tree.entries);
  }
  const selectedPath = findFirstTreeRanklistPath(tree.entries);
  const prContext = options.prUrl ? parsePrContext(options.prUrl) : null;
  const pageTitle = prContext ? `SRK PR ${prContext.label} Review Build` : null;
  const externalDataRootUrl = resolveStaticDataRootUrl(options);
  let dataRoot = externalDataRootUrl ?? 'data';

  await mkdir(outputDir, { recursive: true });
  await rm(join(outputDir, 'data'), { recursive: true, force: true });

  if (gitDiffRefs) {
    const target = await resolvePreviewGitCommit(inputPath, gitDiffRefs.head);
    if (!externalDataRootUrl) {
      dataRoot = `data/${target.commit}`;
      await writeGitDiffDataFiles(join(outputDir, dataRoot), tree.entries, target);
    } else {
      await validateGitDiffDataFiles(tree.entries, target);
    }
  } else if (!externalDataRootUrl) {
    await copyDirectoryDataFiles(inputPath, join(outputDir, dataRoot), tree.entries);
  } else {
    await validateDirectoryDataFiles(inputPath, tree.entries);
  }

  const html = await renderPreviewHtml({
    mode: 'directory',
    dataSource: 'static',
    dataRoot,
    ranklist: null,
    id: null,
    assetBase: options.srkAssetBase,
    selectedPath,
    tree,
    watch: false,
    rootLabel: formatPreviewRootLabel(inputPath),
    gitContext: gitState ? { mode: gitState.mode, summaryLabel: gitState.summaryLabel } : null,
    pageTitle,
    prContext,
  });

  await writeFile(join(outputDir, 'index.html'), html, 'utf8');
}

function resolveGitDiffRefs(options: RenderOptions): PreviewGitDiffRefs | null {
  if (!options.gitDiffBase) {
    return null;
  }
  return {
    base: options.gitDiffBase,
    head: options.gitDiffHead ?? 'HEAD',
  };
}

function resolveStaticDataRootUrl(options: RenderOptions): string | null {
  if (!options.staticDataRootUrl) {
    return null;
  }
  return normalizeStaticDataRootUrl(options.staticDataRootUrl);
}

function normalizeStaticDataRootUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new CliError(`Invalid --static-data-root-url "${value}": ${getErrorMessage(error)}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError(`Invalid --static-data-root-url "${value}": only http and https URLs are supported.`);
  }

  return parsed.href.replace(/\/+$/u, '');
}

function toBuildPreviewTreeOptions(
  gitState: Awaited<ReturnType<typeof collectPreviewGitState>>,
): BuildPreviewTreeOptions {
  if (!gitState) {
    return {};
  }
  return {
    gitStatuses: gitState.statuses,
    diffPaths: gitState.mode === 'diff' ? gitState.diffPaths ?? [] : undefined,
  };
}

async function copyDirectoryDataFiles(
  inputPath: string,
  dataRootPath: string,
  entries: PreviewTreeEntry[],
): Promise<void> {
  for (const relativePath of collectRenderableTreePaths(entries)) {
    const sourcePath = resolvePreviewFilePath(inputPath, relativePath);
    const targetPath = resolveDataOutputPath(dataRootPath, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

async function validateDirectoryDataFiles(inputPath: string, entries: PreviewTreeEntry[]): Promise<void> {
  for (const relativePath of collectRenderableTreePaths(entries)) {
    const sourcePath = resolvePreviewFilePath(inputPath, relativePath);
    validateJsonContent(await readFile(sourcePath, 'utf8'), relativePath);
  }
}

async function writeGitDiffDataFiles(
  dataRootPath: string,
  entries: PreviewTreeEntry[],
  target: PreviewGitCommitTarget,
): Promise<void> {
  for (const relativePath of collectRenderableTreePaths(entries)) {
    const targetPath = resolveDataOutputPath(dataRootPath, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writePreviewGitFileAtCommit(target, relativePath, targetPath);
    validateJsonContent(await readFile(targetPath, 'utf8'), relativePath);
  }
}

async function validateGitDiffDataFiles(entries: PreviewTreeEntry[], target: PreviewGitCommitTarget): Promise<void> {
  const validationRoot = await mkdtemp(join(tmpdir(), 'srk-render-data-'));
  try {
    await writeGitDiffDataFiles(validationRoot, entries, target);
  } finally {
    await rm(validationRoot, { recursive: true, force: true });
  }
}

function collectRenderableTreePaths(entries: PreviewTreeEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      if (!entry.disabled) {
        paths.push(entry.path);
      }
      continue;
    }
    paths.push(...collectRenderableTreePaths(entry.children ?? []));
  }
  return paths;
}

function enableGitDiffRenderableFiles(entries: PreviewTreeEntry[]): void {
  for (const entry of entries) {
    if (entry.type === 'file') {
      entry.disabled = entry.gitStatus?.code === 'D';
      continue;
    }
    enableGitDiffRenderableFiles(entry.children ?? []);
  }
}

function resolveDataOutputPath(dataRootPath: string, relativePath: string): string {
  const absoluteDataRootPath = resolve(dataRootPath);
  const targetPath = resolve(absoluteDataRootPath, relativePath);
  const relativeToDataRoot = relative(absoluteDataRootPath, targetPath);
  if (relativeToDataRoot === '' || relativeToDataRoot.startsWith('..') || relativeToDataRoot.includes(`..${sep}`) || isAbsolute(relativeToDataRoot)) {
    throw new CliError(`Refusing to write data path outside output directory: "${relativePath}".`);
  }
  return targetPath;
}

function validateJsonContent(content: string, relativePath: string): void {
  try {
    JSON.parse(content);
  } catch (error) {
    throw new CliError(`Invalid JSON in git ranklist "${relativePath}": ${getErrorMessage(error)}`);
  }
}

function parsePrContext(url: string): PreviewPrContext {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new CliError(`Invalid --pr-url "${url}": ${getErrorMessage(error)}`);
  }

  const prNumberText = parsed.pathname
    .split('/')
    .filter(Boolean)
    .reverse()
    .find((segment) => /^\d+$/u.test(segment));
  if (!prNumberText) {
    throw new CliError(`Unable to infer PR number from --pr-url "${url}".`);
  }

  const number = Number(prNumberText);
  return {
    number,
    label: `#${number}`,
    url,
  };
}

import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { collectPreviewGitState, type PreviewGitContext, type PreviewGitDiffRefs } from '../git/status.js';
import { DEFAULT_SRK_ASSET_BASE, inferRanklistId } from '../rendering/assets.js';
import {
  renderPreviewHtml,
  type PreviewInitData,
  type PreviewRanklistPayload,
  type PreviewTreeEntry,
} from '../rendering/template.js';
import { formatPreviewRootLabel } from './root-label.js';
import { CliError, getErrorMessage } from '../utils/errors.js';
import { readJsonFile } from '../utils/files.js';
import {
  assertPreviewRanklistFile,
  buildPreviewTree,
  findFirstRanklistPath,
  findFirstTreeRanklistPath,
  type BuildPreviewTreeOptions,
  resolvePreviewFilePath,
} from './tree.js';

export interface PreviewServerOptions {
  inputPath: string;
  host?: string;
  port: number;
  portWasSpecified: boolean;
  open: boolean;
  watch: boolean;
  srkAssetBase: string;
  gitDiffBase?: string;
  gitDiffHead?: string;
}

export interface PreviewServerUrl {
  label: 'Local' | 'Network' | 'Host';
  url: string;
}

type PreviewNetworkInterfaces = Record<
  string,
  Array<{
    address: string;
    family: string | number;
    internal: boolean;
  }> | undefined
>;

interface PreviewContext {
  mode: 'single' | 'directory';
  inputPath: string;
  rootPath: string;
  selectedPath: string | null;
  assetBase: string;
  watch: boolean;
  rootLabel: string;
  gitDiffRefs: PreviewGitDiffRefs | null;
  gitContext: PreviewGitContext | null;
  gitWatchPaths: string[];
}

interface WatcherLike {
  close: () => Promise<void>;
  on: (event: string, listener: (...args: unknown[]) => void) => WatcherLike;
}

export async function startPreviewServer(options: PreviewServerOptions): Promise<void> {
  const context = await createPreviewContext(options);
  const eventClients = new Set<ServerResponse>();

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(context, eventClients, request, response);
    } catch (error) {
      writeError(response, error);
    }
  });

  let watcher: WatcherLike | undefined;
  let watcherReady: Promise<void> | undefined;
  if (options.watch) {
    const { watch } = await import('chokidar');
    const gitWatchPaths = new Set(context.gitWatchPaths.map((path) => resolve(path)));
    watcher = watch([context.inputPath, ...context.gitWatchPaths], {
      ignoreInitial: true,
      usePolling: true,
    }) as unknown as WatcherLike;
    watcherReady = new Promise((resolveReady) => {
      watcher?.on('ready', () => resolveReady());
    });
    watcher.on('all', (eventName, changedPath) => {
      const changedAbsolutePath = resolve(String(changedPath));
      if (gitWatchPaths.has(changedAbsolutePath)) {
        broadcastEvent(eventClients, 'tree-changed', {});
        return;
      }
      const relativePath = normalizePath(relative(context.rootPath, String(changedPath)));
      broadcastEvent(eventClients, 'ranklist-changed', { path: relativePath });
      if (eventName !== 'change') {
        broadcastEvent(eventClients, 'tree-changed', {});
      }
    });
    watcher.on('error', (error) => {
      process.stderr.write(`Preview watcher error: ${getErrorMessage(error)}\n`);
    });
    process.stdout.write('Preview watch mode enabled.\n');
  }

  if (watcherReady) {
    await watcherReady;
  }

  let actualPort: number;
  try {
    actualPort = await listenPreviewServer(server, options);
  } catch (error) {
    if (watcher) {
      await watcher.close();
    }
    throw error;
  }
  const urls = formatPreviewServerUrls(options.host, actualPort);
  writePreviewServerUrls(urls);

  if (options.open) {
    openBrowser(urls[0]?.url ?? `http://127.0.0.1:${actualPort}`);
  }

  const stop = async () => {
    for (const client of eventClients) {
      client.end();
    }
    eventClients.clear();
    if (watcher) {
      await watcher.close();
    }
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  };

  await new Promise<void>((resolveStop) => {
    const handleSignal = () => {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      void stop().finally(resolveStop);
    };
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
  });
}

async function listenPreviewServer(server: ReturnType<typeof createServer>, options: PreviewServerOptions): Promise<number> {
  const host = options.host ?? '0.0.0.0';
  let port = options.port;

  while (port <= 65535) {
    try {
      await listenOnce(server, port, host);
      const address = server.address();
      return typeof address === 'object' && address ? address.port : port;
    } catch (error) {
      if (options.portWasSpecified || !isAddressInUseError(error) || port === 0) {
        throw error;
      }
      port += 1;
    }
  }

  throw new CliError(`Unable to find an available preview port starting from ${options.port}.`);
}

async function listenOnce(server: ReturnType<typeof createServer>, port: number, host: string): Promise<void> {
  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

async function createPreviewContext(options: PreviewServerOptions): Promise<PreviewContext> {
  const inputPath = resolve(process.cwd(), options.inputPath);
  const gitDiffRefs = resolveGitDiffRefs(options);
  const inputStat = await stat(inputPath).catch((error: unknown) => {
    throw new CliError(`Unable to inspect preview path "${inputPath}": ${getErrorMessage(error)}`);
  });

  if (inputStat.isFile()) {
    if (gitDiffRefs) {
      throw new CliError('Git diff preview is only supported for directory preview paths.');
    }
    return {
      mode: 'single',
      inputPath,
      rootPath: dirname(inputPath),
      selectedPath: basename(inputPath),
      assetBase: options.srkAssetBase,
      watch: options.watch,
      rootLabel: formatPreviewRootLabel(dirname(inputPath)),
      gitDiffRefs: null,
      gitContext: null,
      gitWatchPaths: [],
    };
  }

  if (inputStat.isDirectory()) {
    const gitState = await collectPreviewGitState(inputPath, gitDiffRefs ?? undefined);
    const treeOptions = toBuildPreviewTreeOptions(gitState);
    const tree = await buildPreviewTree(inputPath, treeOptions);
    return {
      mode: 'directory',
      inputPath,
      rootPath: inputPath,
      selectedPath: gitDiffRefs ? findFirstTreeRanklistPath(tree.entries) : await findFirstRanklistPath(inputPath, treeOptions),
      assetBase: options.srkAssetBase,
      watch: options.watch,
      rootLabel: formatPreviewRootLabel(inputPath),
      gitDiffRefs,
      gitContext: gitState ? { mode: gitState.mode, summaryLabel: gitState.summaryLabel } : null,
      gitWatchPaths: gitState?.watchPaths ?? [],
    };
  }

  throw new CliError(`Preview path "${inputPath}" must be a file or directory.`);
}

async function readDirectoryTree(context: PreviewContext): Promise<{ entries: PreviewTreeEntry[] }> {
  const gitState = await readGitState(context);
  return buildPreviewTree(context.rootPath, toBuildPreviewTreeOptions(gitState));
}

async function readGitContext(context: PreviewContext): Promise<PreviewGitContext | null> {
  const gitState = await readGitState(context);
  return gitState ? { mode: gitState.mode, summaryLabel: gitState.summaryLabel } : null;
}

async function readGitState(context: PreviewContext) {
  if (context.mode !== 'directory') {
    return null;
  }
  return collectPreviewGitState(context.rootPath, context.gitDiffRefs ?? undefined);
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

function resolveGitDiffRefs(options: PreviewServerOptions): PreviewGitDiffRefs | null {
  if (!options.gitDiffBase) {
    return null;
  }
  return {
    base: options.gitDiffBase,
    head: options.gitDiffHead ?? 'HEAD',
  };
}

async function handleRequest(
  context: PreviewContext,
  eventClients: Set<ServerResponse>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method !== 'GET') {
    writeText(response, 405, 'Method Not Allowed');
    return;
  }

  if (requestUrl.pathname === '/') {
    writeHtml(response, await renderPreviewHtml(await createInitialData(context)));
    return;
  }

  if (requestUrl.pathname === '/api/tree') {
    if (context.mode !== 'directory') {
      writeJson(response, { entries: [] });
      return;
    }
    writeJson(response, await readDirectoryTree(context));
    return;
  }

  if (requestUrl.pathname === '/api/ranklist') {
    writeJson(response, await readRanklistPayload(context, requestUrl.searchParams.get('path')));
    return;
  }

  if (requestUrl.pathname === '/api/events') {
    if (!context.watch) {
      writeText(response, 404, 'Watch mode is not enabled.');
      return;
    }
    attachEventClient(eventClients, request, response);
    return;
  }

  writeText(response, 404, 'Not Found');
}

async function createInitialData(context: PreviewContext): Promise<PreviewInitData> {
  const tree = context.mode === 'directory' ? await readDirectoryTree(context) : null;
  const gitContext = context.mode === 'directory' ? await readGitContext(context) : null;
  const payload = await readRanklistPayload(context, context.selectedPath);
  return {
    mode: context.mode,
    dataSource: context.mode === 'directory' || context.watch ? 'http' : 'inline',
    dataRoot: null,
    ...payload,
    tree,
    watch: context.watch,
    rootLabel: context.rootLabel,
    gitContext,
    pageTitle: null,
    prContext: null,
  };
}

async function readRanklistPayload(context: PreviewContext, requestedPath: string | null): Promise<PreviewRanklistPayload> {
  const selectedPath = requestedPath || context.selectedPath;
  if (!selectedPath) {
    return {
      ranklist: null,
      id: null,
      assetBase: context.assetBase,
      selectedPath: null,
    };
  }

  if (context.mode === 'single' && selectedPath !== context.selectedPath) {
    throw new CliError(`Requested ranklist "${selectedPath}" is not the preview target.`, 404);
  }

  const absolutePath = resolvePreviewFilePath(context.rootPath, selectedPath);
  await assertPreviewRanklistFile(absolutePath);
  const ranklist = await readJsonFile(absolutePath, 'ranklist');
  const relativePath = normalizePath(relative(context.rootPath, absolutePath));

  return {
    ranklist,
    id: inferRanklistId(absolutePath),
    assetBase: context.assetBase,
    selectedPath: relativePath,
  };
}

function attachEventClient(
  eventClients: Set<ServerResponse>,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  response.write('\n');
  eventClients.add(response);
  request.on('close', () => {
    eventClients.delete(response);
  });
}

function broadcastEvent(eventClients: Set<ServerResponse>, event: string, data: unknown): void {
  const payload = JSON.stringify(data);
  for (const client of eventClients) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${payload}\n\n`);
  }
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

function writeJson(response: ServerResponse, data: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function writeText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}

function writeError(response: ServerResponse, error: unknown): void {
  const status = error instanceof CliError && error.exitCode >= 400 ? error.exitCode : 500;
  writeText(response, status, getErrorMessage(error));
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

export function formatPreviewServerUrls(
  host: string | undefined,
  port: number,
  interfaces: PreviewNetworkInterfaces = networkInterfaces(),
): PreviewServerUrl[] {
  if (!isExposeHost(host)) {
    return [{ label: isLocalHost(host) ? 'Local' : 'Host', url: formatUrl(host, port) }];
  }

  const urls: PreviewServerUrl[] = [];
  const localAddresses = uniqueAddresses([
    '127.0.0.1',
    ...collectInterfaceAddresses(interfaces, true),
  ]);
  const networkAddresses = uniqueAddresses(collectInterfaceAddresses(interfaces, false));

  for (const address of localAddresses) {
    urls.push({ label: 'Local', url: formatUrl(address, port) });
  }
  for (const address of networkAddresses) {
    urls.push({ label: 'Network', url: formatUrl(address, port) });
  }
  return urls;
}

function writePreviewServerUrls(urls: PreviewServerUrl[]): void {
  process.stdout.write(formatPreviewServerOutput(urls));
}

export function formatPreviewServerOutput(urls: PreviewServerUrl[]): string {
  if (urls.length === 1) {
    return `Preview server running at ${urls[0].url}\n`;
  }

  const hasLocalAndNetwork =
    urls.some((entry) => entry.label === 'Local') && urls.some((entry) => entry.label === 'Network');
  let output = 'Preview server running at:\n';
  for (const entry of urls) {
    const separator = hasLocalAndNetwork && entry.label === 'Local' ? ':   ' : ': ';
    output += `  ${entry.label}${separator}${entry.url}\n`;
  }
  return output;
}

function isExposeHost(host: string | undefined): host is undefined | '0.0.0.0' | '::' | '::0' {
  return !host || host === '0.0.0.0' || host === '::' || host === '::0';
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function collectInterfaceAddresses(interfaces: PreviewNetworkInterfaces, internal: boolean): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal !== internal || !isIpv4Address(entry)) {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return addresses;
}

function isIpv4Address(entry: { family: string | number }): boolean {
  return entry.family === 'IPv4' || entry.family === 4;
}

function uniqueAddresses(addresses: string[]): string[] {
  return [...new Set(addresses)];
}

function formatUrl(host: string, port: number): string {
  return `http://${formatHostForUrl(host)}:${port}`;
}

function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export const previewDefaults = {
  host: undefined,
  port: 3003,
  srkAssetBase: DEFAULT_SRK_ASSET_BASE,
};

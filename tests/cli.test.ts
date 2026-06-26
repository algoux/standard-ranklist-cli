import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, get, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';
import { formatPreviewRootLabel } from '../src/preview/root-label.js';
import { buildPreviewTree, findFirstTreeRanklistPath } from '../src/preview/tree.js';
import { formatPreviewTreeEntryName } from '../src/rendering/tree-labels.js';
import { formatPreviewServerOutput, formatPreviewServerUrls, previewDefaults } from '../src/preview/server.js';
import { formatPreviewGitSummaryLabel } from '../src/rendering/git-context.js';
import { formatContestTime } from '../src/rendering/time.js';
import { resolveOptionalText } from '../src/rendering/text.js';
import { getPreviewTemplateUrl } from '../src/rendering/template.js';
import { parseGitDiffNameStatusZ, parseGitStatusPorcelainZ } from '../src/git/status.js';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDir = join(repoRoot, 'tests', 'fixtures');
const execFileAsync = promisify(execFile);

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'index.ts'), ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function runCliEntrypoint(entrypoint: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function runCliWithTimeout(args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'index.ts'), ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

interface PreviewServer {
  url: string;
  stop: () => Promise<void>;
  output: () => { stdout: string; stderr: string };
}

async function startPreviewServer(args: string[]): Promise<PreviewServer> {
  const child = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'src', 'index.ts'), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      TERM: 'dumb',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`preview server did not start\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`preview server exited with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
    child.stdout.on('data', () => {
      const match = stdout.match(/https?:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
  });

  return {
    url,
    output: () => ({ stdout, stderr }),
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'srk-cli-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function copyFixture(name: string, targetDir: string): Promise<string> {
  const target = join(targetDir, name);
  await writeFile(target, await readFile(join(fixtureDir, name), 'utf8'));
  return target;
}

async function reservePort(port: number, host = '127.0.0.1'): Promise<Server> {
  const server = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

async function reservePortIfAvailable(port: number, host = '127.0.0.1'): Promise<Server | null> {
  try {
    return await reservePort(port, host);
  } catch (error) {
    if (isAddressInUseError(error)) {
      return null;
    }
    throw error;
  }
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function getServerPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') {
    assert.fail(`Expected TCP server address, got ${String(address)}`);
  }
  return address.port;
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

async function hasGit(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return String(stdout).trim();
}

async function createGitPreviewFixture(dir: string): Promise<void> {
  await mkdir(join(dir, 'nested'));
  await writeFile(join(dir, 'changed.srk.json'), await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8'));
  const removed = JSON.parse(await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8')) as { contest: { title: string } };
  removed.contest.title = 'Removed Contest';
  await writeFile(join(dir, 'removed.srk.json'), JSON.stringify(removed), 'utf8');
  await writeFile(join(dir, 'unchanged.srk.json'), await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8'));
  await writeFile(join(dir, 'nested', 'renamed-old.srk.json'), await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8'));

  await git(dir, ['init']);
  await git(dir, ['config', 'user.email', 'srk-test@example.test']);
  await git(dir, ['config', 'user.name', 'SRK Test']);
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'initial']);

  const changed = JSON.parse(await readFile(join(dir, 'changed.srk.json'), 'utf8')) as { contest: { title: string } };
  changed.contest.title = 'Changed Contest';
  await writeFile(join(dir, 'changed.srk.json'), JSON.stringify(changed), 'utf8');
  await rm(join(dir, 'removed.srk.json'));
  const added = JSON.parse(await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8')) as { contest: { title: string } };
  added.contest.title = 'Added Contest';
  await writeFile(join(dir, 'added.srk.json'), JSON.stringify(added), 'utf8');
  await git(dir, ['mv', join('nested', 'renamed-old.srk.json'), join('nested', 'renamed-new.srk.json')]);
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'change ranklists']);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (response.status !== 200) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function waitForSseEvent(url: string, eventName: string, trigger: () => Promise<void>): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let text = '';
    let settled = false;
    const timeout = setTimeout(
      () => finish(reject, new Error(`Timed out waiting for SSE event "${eventName}". Received:\n${text}`)),
      5_000,
    );
    const request = get(url, async (response) => {
      if (response.statusCode !== 200) {
        finish(reject, new Error(`${response.statusCode} ${response.statusMessage}`));
        return;
      }

      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        text += chunk;
        const eventIndex = text.indexOf(`event: ${eventName}\n`);
        if (eventIndex !== -1 && text.slice(eventIndex).includes('\n\n')) {
          finish(resolve, text);
        }
      });
      response.on('end', () => {
        finish(reject, new Error(`SSE stream ended before "${eventName}". Received:\n${text}`));
      });
      response.on('error', (error) => {
        finish(reject, error);
      });

      try {
        await trigger();
      } catch (error) {
        finish(reject, error);
      }
    });

    request.on('error', (error) => {
      finish(reject, error);
    });

    function finish<T>(complete: (value: T) => void, value: T) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.destroy();
      complete(value);
    }
  });
}

describe('srk command', () => {
  test('resolves optional preview text without throwing for nullish values', () => {
    assert.equal(resolveOptionalText(null), '');
    assert.equal(resolveOptionalText(undefined), '');
    assert.equal(resolveOptionalText('Contest'), 'Contest');
  });

  test('formats contest time with a single trailing browser timezone', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    try {
      assert.equal(
        formatContestTime({
          startAt: '2000-01-01T09:00:00+08:00',
          duration: [5, 'h'],
        }),
        '2000-01-01 09:00:00 ~ 2000-01-01 14:00:00 +08:00',
      );
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });

  test('formats default preview host as exposed local and network URLs', () => {
    assert.deepEqual(
      formatPreviewServerUrls(undefined, 3003, {
        lo0: [
          { address: '127.0.0.1', family: 'IPv4', internal: true },
          { address: '::1', family: 'IPv6', internal: true },
        ],
        en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
      }),
      [
        { label: 'Local', url: 'http://127.0.0.1:3003' },
        { label: 'Network', url: 'http://192.168.1.20:3003' },
      ],
    );
  });

  test('aligns Local preview URLs when Network URLs are also printed', () => {
    assert.equal(
      formatPreviewServerOutput([
        { label: 'Local', url: 'http://127.0.0.1:3003' },
        { label: 'Network', url: 'http://192.168.1.20:3003' },
      ]),
      [
        'Preview server running at:',
        '  Local:   http://127.0.0.1:3003',
        '  Network: http://192.168.1.20:3003',
        '',
      ].join('\n'),
    );
  });

  test('formats preview directory labels for the file tree sidebar', () => {
    assert.equal(formatPreviewTreeEntryName({ type: 'file', name: 'ccpc2015nanyang.srk.json' }), 'ccpc2015nanyang');
    assert.equal(formatPreviewTreeEntryName({ type: 'directory', name: 'ccpc2015' }), 'ccpc2015');
    assert.equal(
      formatPreviewRootLabel(join(repoRoot, 'tests', 'fixtures'), repoRoot),
      'tests/fixtures',
    );
    assert.equal(formatPreviewRootLabel(repoRoot, repoRoot), '.');
  });

  test('formats preview git change summary with shortened full SHA refs', () => {
    assert.equal(
      formatPreviewGitSummaryLabel(
        'Changes: 0123456789abcdef0123456789abcdef01234567...abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      ),
      'Changes: 01234567...abcdefab',
    );
    assert.equal(formatPreviewGitSummaryLabel('Changes: main...HEAD'), 'Changes: main...HEAD');
    assert.equal(formatPreviewGitSummaryLabel('Working tree'), 'Working tree');
  });

  test('parses porcelain git status records for preview badges', () => {
    const statuses = parseGitStatusPorcelainZ(
      [
        '?? untracked.srk.json',
        ' M modified.srk.json',
        'M  staged.srk.json',
        'A  added.srk.json',
        'R  renamed-new.srk.json',
        'renamed-old.srk.json',
        'C  copied.srk.json',
        'copied-from.srk.json',
        ' D deleted.srk.json',
      ].join('\0') + '\0',
    );

    assert.equal(statuses.get('untracked.srk.json')?.code, 'U');
    assert.equal(statuses.get('modified.srk.json')?.code, 'M');
    assert.equal(statuses.get('staged.srk.json')?.code, 'M');
    assert.equal(statuses.get('added.srk.json')?.code, 'A');
    assert.equal(statuses.get('renamed-new.srk.json')?.code, 'R');
    assert.equal(statuses.has('renamed-old.srk.json'), false);
    assert.equal(statuses.get('copied.srk.json')?.code, 'A');
    assert.equal(statuses.has('copied-from.srk.json'), false);
    assert.equal(statuses.get('deleted.srk.json')?.code, 'D');
  });

  test('parses diff name-status records using rename and copy targets', () => {
    const statuses = parseGitDiffNameStatusZ(
      ['A', 'added.srk.json', 'M', 'modified.srk.json', 'D', 'deleted.srk.json', 'R100', 'old.srk.json', 'new.srk.json', 'C075', 'source.srk.json', 'copied.srk.json'].join(
        '\0',
      ) + '\0',
    );

    assert.equal(statuses.get('added.srk.json')?.code, 'A');
    assert.equal(statuses.get('modified.srk.json')?.code, 'M');
    assert.equal(statuses.get('deleted.srk.json')?.code, 'D');
    assert.equal(statuses.get('new.srk.json')?.code, 'R');
    assert.equal(statuses.has('old.srk.json'), false);
    assert.equal(statuses.get('copied.srk.json')?.code, 'A');
    assert.equal(statuses.has('source.srk.json'), false);
  });

  test('annotates preview trees with file and aggregated directory git status', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'nested'));
      await copyFixture('conflict.srk.json', dir);
      await writeFile(join(dir, 'nested', 'changed.srk.json'), await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8'));

      const tree = await buildPreviewTree(dir, {
        gitStatuses: new Map([
          ['conflict.srk.json', { code: 'A', tone: 'green' }],
          ['nested/changed.srk.json', { code: 'M', tone: 'blue' }],
        ]),
      });

      assert.equal(tree.entries[0].path, 'conflict.srk.json');
      assert.equal(tree.entries[0].gitStatus?.code, 'A');
      assert.equal(tree.entries[1].path, 'nested');
      assert.equal(tree.entries[1].gitStatus?.code, 'M');
      assert.equal(tree.entries[1].children?.[0].gitStatus?.tone, 'blue');
    });
  });

  test('builds diff preview trees from changed SRK paths and disables deleted files', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'nested'));
      await copyFixture('conflict.srk.json', dir);
      await writeFile(join(dir, 'nested', 'changed.srk.json'), await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8'));

      const tree = await buildPreviewTree(dir, {
        diffPaths: ['deleted.srk.json', 'nested/changed.srk.json', 'notes.txt'],
        gitStatuses: new Map([
          ['deleted.srk.json', { code: 'D', tone: 'red' }],
          ['nested/changed.srk.json', { code: 'M', tone: 'blue' }],
        ]),
      });

      assert.deepEqual(
        tree.entries.map((entry) => `${entry.type}:${entry.path}:${entry.gitStatus?.code ?? '-'}`),
        ['file:deleted.srk.json:D', 'directory:nested:M'],
      );
      assert.equal(tree.entries[0].disabled, true);
      assert.equal(tree.entries[1].children?.[0].disabled, false);
      assert.equal(findFirstTreeRanklistPath(tree.entries), 'nested/changed.srk.json');
    });
  });

  test('prints root help', async () => {
    const result = await runCli(['--help']);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage: srk/);
    assert.match(result.stdout, /validate/);
    assert.match(result.stdout, /diagnose/);
    assert.match(result.stdout, /patch/);
  });

  test('prints package version', async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { version: string };
    const result = await runCli(['--version']);

    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), packageJson.version);
  });

  test('starts when executed through a bin symlink', async () => {
    await withTempDir(async (dir) => {
      const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { version: string };
      const binPath = join(dir, 'srk');
      await symlink(join(repoRoot, 'src', 'index.ts'), binPath);

      const result = await runCliEntrypoint(binPath, ['--version']);

      assert.equal(result.code, 0);
      assert.equal(result.stdout.trim(), packageJson.version);
    });
  });

  test('prints subcommand help', async () => {
    const validate = await runCli(['validate', '--help']);
    const diagnose = await runCli(['diagnose', '--help']);
    const patch = await runCli(['patch', '--help']);

    assert.equal(validate.code, 0);
    assert.match(validate.stdout, /Usage: srk validate/);
    assert.match(validate.stdout, /srk\.json/);

    assert.equal(diagnose.code, 0);
    assert.match(diagnose.stdout, /Usage: srk diagnose/);
    assert.match(diagnose.stdout, /--format/);
    assert.match(diagnose.stdout, /--patch/);

    assert.equal(patch.code, 0);
    assert.match(patch.stdout, /Usage: srk patch/);
    assert.match(patch.stdout, /--output/);
    assert.match(patch.stdout, /--in-place/);

    const preview = await runCli(['preview', '--help']);
    assert.equal(preview.code, 0);
    assert.match(preview.stdout, /Usage: srk preview/);
    assert.match(preview.stdout, /--watch/);
    assert.match(preview.stdout, /--host/);
    assert.match(preview.stdout, /-h, --host/);
    assert.match(preview.stdout, /--port/);
    assert.match(preview.stdout, /-p, --port/);
    assert.match(preview.stdout, /--open/);
    assert.match(preview.stdout, /--srk-asset-base/);
    assert.match(preview.stdout, /--git-diff-base/);
    assert.match(preview.stdout, /--git-diff-head/);

    const render = await runCli(['render', '--help']);
    assert.equal(render.code, 0);
    assert.match(render.stdout, /Usage: srk render/);
    assert.match(render.stdout, /--output/);
    assert.match(render.stdout, /--srk-asset-base/);
    assert.match(render.stdout, /--git-diff-base/);
    assert.match(render.stdout, /--git-diff-head/);
    assert.match(render.stdout, /--pr-url/);
  });

  test('validates a schema-valid SRK file without running diagnostics', async () => {
    const fixturePath = join(fixtureDir, 'conflict.srk.json');
    const result = await runCli(['validate', fixturePath]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, `SRK validation OK: ${fixturePath}\n`);
    assert.equal(result.stderr, '');
  });

  test('allows unknown extension fields while validating known field shapes', async () => {
    await withTempDir(async (dir) => {
      const ranklistPath = await copyFixture('conflict.srk.json', dir);
      const ranklist = JSON.parse(await readFile(ranklistPath, 'utf8')) as {
        extensionNote?: string;
        contest: { extraContestField?: { enabled: boolean } };
        rows: Array<{ user: { extensionUserField?: string } }>;
      };
      ranklist.extensionNote = 'kept by downstream tooling';
      ranklist.contest.extraContestField = { enabled: true };
      ranklist.rows[0].user.extensionUserField = 'local-only';
      await writeFile(ranklistPath, JSON.stringify(ranklist), 'utf8');

      const result = await runCli(['validate', ranklistPath]);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, `SRK validation OK: ${ranklistPath}\n`);
      assert.equal(result.stderr, '');
    });
  });

  test('rejects missing required SRK fields with a useful schema path', async () => {
    await withTempDir(async (dir) => {
      const ranklistPath = await copyFixture('conflict.srk.json', dir);
      const ranklist = JSON.parse(await readFile(ranklistPath, 'utf8')) as Record<string, unknown>;
      delete ranklist.contest;
      await writeFile(ranklistPath, JSON.stringify(ranklist), 'utf8');

      const result = await runCli(['validate', ranklistPath]);

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, new RegExp(`SRK validation failed: ${escapeRegExp(ranklistPath)}`));
      assert.match(result.stderr, /\/contest/);
      assert.match(result.stderr, /required property/i);
    });
  });

  test('rejects wrong field types and invalid schema formats with useful paths', async () => {
    await withTempDir(async (dir) => {
      const ranklistPath = await copyFixture('conflict.srk.json', dir);
      const ranklist = JSON.parse(await readFile(ranklistPath, 'utf8')) as {
        contest: { startAt: string };
        rows: Array<{ score: { time: [number, string] } }>;
      };
      ranklist.contest.startAt = 'not-a-date';
      ranklist.rows[0].score.time = [10, 'fortnight'];
      await writeFile(ranklistPath, JSON.stringify(ranklist), 'utf8');

      const result = await runCli(['validate', ranklistPath]);

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /\/contest\/startAt/);
      assert.match(result.stderr, /date-time/);
      assert.match(result.stderr, /\/rows\/0\/score\/time\/1/);
      assert.match(result.stderr, /allowed value/i);
    });
  });

  test('validate keeps the existing invalid JSON error style', async () => {
    await withTempDir(async (dir) => {
      const ranklistPath = join(dir, 'invalid.srk.json');
      await writeFile(ranklistPath, '{ invalid json', 'utf8');

      const result = await runCli(['validate', ranklistPath]);

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /srk: Invalid JSON in ranklist/);
      assert.match(result.stderr, new RegExp(escapeRegExp(ranklistPath)));
    });
  });

  test('prints JSON diagnostics for an explicit SRK file', async () => {
    const result = await runCli(['diagnose', '--format=json', join(fixtureDir, 'conflict.srk.json')]);

    assert.equal(result.code, 0, result.stderr);
    const diagnostics = JSON.parse(result.stdout) as { issues: Array<{ code: string }> };
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'FIRST_BLOOD_CONFLICT'));
  });

  test('accepts original case-insensitive diagnose format values', async () => {
    const result = await runCli(['diagnose', '-f', 'JSON', join(fixtureDir, 'conflict.srk.json')]);

    assert.equal(result.code, 0, result.stderr);
    const diagnostics = JSON.parse(result.stdout) as { issues: Array<{ code: string }> };
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'FIRST_BLOOD_CONFLICT'));
  });

  test('prints text diagnostics using the original CLI report layout', async () => {
    const fixturePath = join(fixtureDir, 'conflict.srk.json');
    const result = await runCli(['diagnose', '-f', 'text', fixturePath]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^SRK Diagnostics\n/);
    assert.match(result.stdout, new RegExp(`^File: ${escapeRegExp(fixturePath)}$`, 'm'));
    assert.match(result.stdout, /^Issues: 9 \(error 1, warning 2, info 6\)$/m);
    assert.match(result.stdout, /^  solutionTime: min \(samples 2, zero 0, invalid 0, declared min\)$/m);
    assert.match(result.stdout, /^  statusTime:   min \(samples 2, zero 0, invalid 0, declared min\)$/m);
    assert.match(result.stdout, /^  \[missing\]  Contest banner: 0\/1 \(0\.0%\)$/m);
    assert.match(result.stdout, /^  \[complete\] Problem first-blood declarations: 1\/1 \(100\.0%\)$/m);
    assert.match(result.stdout, /^  \[fail\] First-blood declarations: 1\/1 failed$/m);
    assert.match(result.stdout, /^  firstBlood:\n    - A: user u1, row 0, time \[10,"min"\]$/m);
    assert.match(
      result.stdout,
      /^  \[error\/high\]\s+FIRST_BLOOD_CONFLICT: Problem A first-blood declaration conflicts with the earliest accepted solution \(row=1, problem=0, user=u2, item=firstBlood\)$/m,
    );
    assert.doesNotMatch(result.stdout, /Solution time: actual=/);
  });

  test('prints original mismatch detail lines in text diagnostics', async () => {
    const result = await runCli(['diagnose', join(fixtureDir, 'status-mismatch.srk.json')]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /STATUS_SUMMARY_MISMATCH/);
    assert.match(result.stdout, /^      actual: \{"result":"AC","tries":3,"time":\[30,"min"\],"solutions":\[/m);
    assert.match(result.stdout, /^      expect: \{"result":"AC","tries":2,"time":\[30,"min"\],"solutions":\[/m);
    assert.match(result.stdout, /^  sorter:\n    - \{.+\} \((?:low|medium|high|certain)\) resolves .+$/m);
  });

  test('writes a generated patch while preserving text diagnostics output', async () => {
    await withTempDir(async (dir) => {
      const patchPath = join(dir, 'generated.patch.json');
      const result = await runCli(['diagnose', `--patch=${patchPath}`, join(fixtureDir, 'conflict.srk.json')]);

      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /SRK Diagnostics/);
      assert.match(result.stdout, /Precision/);
      assert.match(result.stdout, /Completeness/);
      assert.match(result.stdout, /Correctness/);
      assert.match(result.stdout, /Suggestions/);
      assert.match(result.stdout, /Issues/);

      const patch = JSON.parse(await readFile(patchPath, 'utf8')) as { type: string; operations: unknown[] };
      assert.equal(patch.type, 'srk-patch');
      assert.ok(patch.operations.length > 0);
    });
  });

  test('applies a patch and prints patched ranklist JSON to stdout', async () => {
    const result = await runCli([
      'patch',
      join(fixtureDir, 'conflict.srk.json'),
      join(fixtureDir, 'banner.patch.json'),
    ]);

    assert.equal(result.code, 0, result.stderr);
    const patched = JSON.parse(result.stdout) as { contest: { banner?: string } };
    assert.equal(patched.contest.banner, 'https://example.com/banner.png');
  });

  test('applies a patch to an output file', async () => {
    await withTempDir(async (dir) => {
      const outputPath = join(dir, 'fixed.srk.json');
      const result = await runCli([
        'patch',
        '-o',
        outputPath,
        join(fixtureDir, 'conflict.srk.json'),
        join(fixtureDir, 'banner.patch.json'),
      ]);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      const patched = JSON.parse(await readFile(outputPath, 'utf8')) as { contest: { banner?: string } };
      assert.equal(patched.contest.banner, 'https://example.com/banner.png');
    });
  });

  test('applies a patch in place', async () => {
    await withTempDir(async (dir) => {
      const ranklistPath = await copyFixture('conflict.srk.json', dir);
      const patchPath = await copyFixture('banner.patch.json', dir);
      const result = await runCli(['patch', '--in-place', ranklistPath, patchPath]);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      const patched = JSON.parse(await readFile(ranklistPath, 'utf8')) as { contest: { banner?: string } };
      assert.equal(patched.contest.banner, 'https://example.com/banner.png');
    });
  });

  test('rejects mutually exclusive output modes', async () => {
    const result = await runCli([
      'patch',
      '--in-place',
      '--output',
      'fixed.json',
      join(fixtureDir, 'conflict.srk.json'),
      join(fixtureDir, 'banner.patch.json'),
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /cannot be combined/i);
  });

  test('rejects the legacy overwrite flag', async () => {
    for (const flag of ['--overwrite', '--overwrite=true', '--overwrite=false']) {
      const result = await runCli([
        'patch',
        flag,
        join(fixtureDir, 'conflict.srk.json'),
        join(fixtureDir, 'banner.patch.json'),
      ]);

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /overwrite/i);
    }
  });

  test('renders a standalone HTML document to stdout', async () => {
    const fixturePath = join(fixtureDir, 'conflict.srk.json');
    const result = await runCli(['render', fixturePath]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^<!doctype html>/i);
    assert.match(result.stdout, /window\.__SRK_PREVIEW_INIT__ = /);
    assert.match(result.stdout, /name="viewport" content="width=1280"/);
    assert.match(result.stdout, /"mode":"single"/);
    assert.match(result.stdout, /"id":"conflict"/);
    assert.match(result.stdout, /https:\/\/cdn\.algoux\.cn\/srk-storage/);
    assert.match(result.stdout, /Contest/);
  });

  test('renders a standalone HTML document to an output file', async () => {
    await withTempDir(async (dir) => {
      const outputPath = join(dir, 'ranklist.html');
      const result = await runCli(['render', '-o', outputPath, join(fixtureDir, 'conflict.srk.json')]);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      const html = await readFile(outputPath, 'utf8');
      assert.match(html, /^<!doctype html>/i);
      assert.match(html, /"id":"conflict"/);
    });
  });

  test('escapes injected ranklist JSON inside the render HTML init script', async () => {
    await withTempDir(async (dir) => {
      const ranklistPath = await copyFixture('conflict.srk.json', dir);
      const ranklist = JSON.parse(await readFile(ranklistPath, 'utf8')) as { contest: { title: string } };
      ranklist.contest.title = '</script><script>alert("xss")</script>';
      await writeFile(ranklistPath, JSON.stringify(ranklist), 'utf8');

      const result = await runCli(['render', ranklistPath]);

      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /<\/script><script>alert/);
      assert.match(result.stdout, /\\u003c\/script\\u003e/);
    });
  });

  test('render rejects git diff and PR options for a single file input', async () => {
    const filePath = join(fixtureDir, 'conflict.srk.json');

    const diffResult = await runCli(['render', '--git-diff-base', 'main', filePath]);
    assert.notEqual(diffResult.code, 0);
    assert.match(diffResult.stderr, /git diff.*directory render/i);

    const prResult = await runCli(['render', '--pr-url', 'https://github.com/algoux/example/pull/123', filePath]);
    assert.notEqual(prResult.code, 0);
    assert.match(prResult.stderr, /PR review.*directory render/i);
  });

  test('render directory mode requires an output directory', async () => {
    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);

      const result = await runCli(['render', dir]);

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /directory render.*requires.*--output/i);
    });
  });

  test('render directory mode writes index HTML and copies all SRK JSON files preserving paths', async () => {
    await withTempDir(async (dir) => {
      const inputDir = join(dir, 'ranklists');
      const outputDir = join(dir, 'site');
      await mkdir(join(inputDir, 'nested'), { recursive: true });
      await copyFixture('conflict.srk.json', inputDir);
      await writeFile(join(inputDir, 'nested', 'visible.srk.json'), await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8'));
      await writeFile(join(inputDir, 'nested', 'ignored.json'), '{}', 'utf8');

      const result = await runCli(['render', '-o', outputDir, inputDir]);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      const html = await readFile(join(outputDir, 'index.html'), 'utf8');
      const init = extractPreviewInit(html);
      assert.equal(init.mode, 'directory');
      assert.equal(init.ranklist, null);
      assert.equal(init.dataSource, 'static');
      assert.equal(init.dataRoot, 'data');
      assert.equal(init.selectedPath, 'conflict.srk.json');
      assert.deepEqual(init.tree?.entries.map((entry) => `${entry.type}:${entry.path}`), [
        'file:conflict.srk.json',
        'directory:nested',
      ]);

      assert.equal(
        await readFile(join(outputDir, 'data', 'conflict.srk.json'), 'utf8'),
        await readFile(join(inputDir, 'conflict.srk.json'), 'utf8'),
      );
      assert.equal(
        await readFile(join(outputDir, 'data', 'nested', 'visible.srk.json'), 'utf8'),
        await readFile(join(inputDir, 'nested', 'visible.srk.json'), 'utf8'),
      );
      await assert.rejects(readFile(join(outputDir, 'data', 'nested', 'ignored.json'), 'utf8'));
    });
  });

  test('render git diff mode writes changed SRK files from the resolved head commit under data commit root', async (t) => {
    if (!(await hasGit())) {
      t.skip('git is not available');
      return;
    }

    await withTempDir(async (dir) => {
      await createGitPreviewFixture(dir);
      const commit = await git(dir, ['rev-parse', 'HEAD']);
      const workingTree = JSON.parse(await readFile(join(dir, 'changed.srk.json'), 'utf8')) as { contest: { title: string } };
      workingTree.contest.title = 'Working Tree Contest';
      await writeFile(join(dir, 'changed.srk.json'), JSON.stringify(workingTree), 'utf8');
      const outputDir = join(dir, 'site');

      const result = await runCli([
        'render',
        '--git-diff-base',
        'HEAD~1',
        '--git-diff-head',
        'HEAD',
        '-o',
        outputDir,
        dir,
      ]);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '');
      const html = await readFile(join(outputDir, 'index.html'), 'utf8');
      const init = extractPreviewInit(html);
      assert.equal(init.dataRoot, `data/${commit}`);
      assert.equal(init.gitContext?.summaryLabel, 'Changes: HEAD~1...HEAD');
      assert.equal(init.selectedPath, 'added.srk.json');
      assert.deepEqual(
        init.tree?.entries.map((entry) => `${entry.type}:${entry.path}:${entry.gitStatus?.code ?? '-'}:${entry.disabled ?? false}`),
        [
          'file:added.srk.json:A:false',
          'file:changed.srk.json:M:false',
          'file:removed.srk.json:D:true',
          'directory:nested:R:false',
        ],
      );

      const changed = JSON.parse(await readFile(join(outputDir, 'data', commit, 'changed.srk.json'), 'utf8')) as {
        contest: { title: string };
      };
      assert.equal(changed.contest.title, 'Changed Contest');
      await readFile(join(outputDir, 'data', commit, 'added.srk.json'), 'utf8');
      await readFile(join(outputDir, 'data', commit, 'nested', 'renamed-new.srk.json'), 'utf8');
      await assert.rejects(readFile(join(outputDir, 'data', commit, 'removed.srk.json'), 'utf8'));
    });
  });

  test('render PR review mode writes PR context and page title', async (t) => {
    if (!(await hasGit())) {
      t.skip('git is not available');
      return;
    }

    await withTempDir(async (dir) => {
      await createGitPreviewFixture(dir);
      const outputDir = join(dir, 'site');

      const result = await runCli([
        'render',
        '--git-diff-base',
        'HEAD~1',
        '--pr-url',
        'https://github.com/algoux/standard-ranklist-cli/pull/123',
        '-o',
        outputDir,
        dir,
      ]);

      assert.equal(result.code, 0, result.stderr);
      const html = await readFile(join(outputDir, 'index.html'), 'utf8');
      const init = extractPreviewInit(html);
      assert.match(html, /<title>SRK PR #123 Review Build<\/title>/);
      assert.equal(init.pageTitle, 'SRK PR #123 Review Build');
      assert.deepEqual(init.prContext, {
        number: 123,
        label: '#123',
        url: 'https://github.com/algoux/standard-ranklist-cli/pull/123',
      });
    });
  });

  test('render PR review mode requires git diff directory output', async () => {
    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);

      const result = await runCli(['render', '--pr-url', 'https://github.com/algoux/example/pull/123', '-o', join(dir, 'site'), dir]);

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /--pr-url.*--git-diff-base/i);
    });
  });

  test('preview directory API lists only directories and *.srk.json files', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'nested'));
      await copyFixture('conflict.srk.json', dir);
      await writeFile(join(dir, 'other.json'), '{}', 'utf8');
      await writeFile(join(dir, 'nested', 'visible.srk.json'), await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8'));
      await writeFile(join(dir, 'nested', 'hidden.json'), '{}', 'utf8');

      const server = await startPreviewServer(['preview', '--port', '0', dir]);
      try {
        const tree = await fetchJson<{ entries: Array<{ name: string; type: string; children?: Array<{ name: string }> }> }>(
          `${server.url}/api/tree`,
        );

        assert.deepEqual(
          tree.entries.map((entry) => `${entry.type}:${entry.name}`),
          ['file:conflict.srk.json', 'directory:nested'],
        );
        assert.deepEqual(tree.entries[1].children?.map((entry) => entry.name), ['visible.srk.json']);
      } finally {
        await server.stop();
      }
    });
  });

  test('preview ranklist API rejects paths outside the preview root', async () => {
    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);
      const server = await startPreviewServer(['preview', '--port', '0', dir]);
      try {
        const response = await fetch(`${server.url}/api/ranklist?path=../outside.srk.json`);
        assert.equal(response.status, 403);
        assert.match(await response.text(), /outside preview root/i);
      } finally {
        await server.stop();
      }
    });
  });

  test('preview ranklist API returns srk data and asset context for a selected file', async () => {
    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);
      const server = await startPreviewServer([
        'preview',
        '--port',
        '0',
        '--srk-asset-base',
        'https://assets.example.test/base',
        dir,
      ]);
      try {
        const payload = await fetchJson<{
          id: string;
          assetBase: string;
          selectedPath: string;
          ranklist: { contest: { title: string } };
        }>(`${server.url}/api/ranklist?path=conflict.srk.json`);

        assert.equal(payload.id, 'conflict');
        assert.equal(payload.assetBase, 'https://assets.example.test/base');
        assert.equal(payload.selectedPath, 'conflict.srk.json');
        assert.equal(payload.ranklist.contest.title, 'Contest');
      } finally {
        await server.stop();
      }
    });
  });

  test('preview accepts short host and port options', async () => {
    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);
      const server = await startPreviewServer(['preview', '-h', '127.0.0.1', '-p', '0', dir]);
      try {
        assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      } finally {
        await server.stop();
      }
    });
  });

  test('preview without explicit port falls forward when the default port is occupied', async () => {
    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);
      const blocker = await reservePortIfAvailable(previewDefaults.port, '0.0.0.0');
      const server = await startPreviewServer(['preview', dir]);
      try {
        const actualPort = Number(new URL(server.url).port);
        assert.ok(
          actualPort > previewDefaults.port,
          `expected a port after ${previewDefaults.port}, got ${actualPort}`,
        );
      } finally {
        await server.stop();
        await closeServer(blocker);
      }
    });
  });

  test('preview with an explicit occupied port fails instead of falling forward', async () => {
    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);
      const blocker = await reservePort(0, '127.0.0.1');
      const occupiedPort = getServerPort(blocker);
      let unexpectedServer: PreviewServer | null = null;

      try {
        try {
          unexpectedServer = await startPreviewServer([
            'preview',
            '--host',
            '127.0.0.1',
            '--port',
            String(occupiedPort),
            dir,
          ]);
          assert.fail(`preview started on ${unexpectedServer.url} despite explicit occupied port ${occupiedPort}`);
        } catch (error) {
          assert.match(String(error), /EADDRINUSE|address already in use|already in use/i);
        }
      } finally {
        await unexpectedServer?.stop();
        await closeServer(blocker);
      }
    });
  });

  test('preview watch with an explicit occupied port exits instead of keeping the watcher alive', async () => {
    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);
      const blocker = await reservePort(0, '127.0.0.1');
      const occupiedPort = getServerPort(blocker);

      try {
        const result = await runCliWithTimeout(
          [
            'preview',
            '--watch',
            '--host',
            '127.0.0.1',
            '--port',
            String(occupiedPort),
            dir,
          ],
          3_000,
        );
        assert.equal(result.timedOut, false, `preview process hung after listen failure\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /EADDRINUSE|address already in use|already in use/i);
      } finally {
        await closeServer(blocker);
      }
    });
  });

  test('preview git diff mode is rejected for a single file input', async () => {
    const result = await runCli(['preview', '--git-diff-base', 'main', join(fixtureDir, 'conflict.srk.json')]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /git diff.*directory preview/i);
  });

  test('preview git diff mode lists only changed SRK files and exposes diff context', async (t) => {
    if (!(await hasGit())) {
      t.skip('git is not available');
      return;
    }

    await withTempDir(async (dir) => {
      await createGitPreviewFixture(dir);

      const server = await startPreviewServer([
        'preview',
        '--port',
        '0',
        '--git-diff-base',
        'HEAD~1',
        '--git-diff-head',
        'HEAD',
        dir,
      ]);
      try {
        const html = await (await fetch(server.url)).text();
        assert.match(html, /"gitContext":\{"mode":"diff","summaryLabel":"Changes: HEAD~1\.\.\.HEAD"\}/);
        assert.match(html, /"selectedPath":"added\.srk\.json"/);

        const tree = await fetchJson<{
          entries: Array<{
            name: string;
            path: string;
            type: string;
            disabled?: boolean;
            gitStatus?: { code: string };
            children?: Array<{ path: string; gitStatus?: { code: string } }>;
          }>;
        }>(`${server.url}/api/tree`);

        assert.deepEqual(
          tree.entries.map((entry) => `${entry.type}:${entry.path}:${entry.gitStatus?.code ?? '-'}:${entry.disabled ?? false}`),
          [
            'file:added.srk.json:A:false',
            'file:changed.srk.json:M:false',
            'file:removed.srk.json:D:true',
            'directory:nested:R:false',
          ],
        );
        assert.deepEqual(tree.entries[3].children?.map((entry) => `${entry.path}:${entry.gitStatus?.code}`), [
          'nested/renamed-new.srk.json:R',
        ]);
      } finally {
        await server.stop();
      }
    });
  });

  test('preview watch mode emits tree changes when the git index changes', async (t) => {
    if (!(await hasGit())) {
      t.skip('git is not available');
      return;
    }

    await withTempDir(async (dir) => {
      await copyFixture('conflict.srk.json', dir);
      await git(dir, ['init']);
      await git(dir, ['config', 'user.email', 'srk-test@example.test']);
      await git(dir, ['config', 'user.name', 'SRK Test']);
      await git(dir, ['add', '.']);
      await git(dir, ['commit', '-m', 'initial']);

      const server = await startPreviewServer(['preview', '--watch', '--port', '0', dir]);
      try {
        const text = await waitForSseEvent(`${server.url}/api/events`, 'tree-changed', async () => {
          await writeFile(join(dir, 'indexed.srk.json'), await readFile(join(fixtureDir, 'conflict.srk.json'), 'utf8'));
          await git(dir, ['add', 'indexed.srk.json']);
        });

        assert.match(text, /event: tree-changed/);
      } finally {
        await server.stop();
      }
    });
  });

  test('preview watch mode emits ranklist change events over SSE', async () => {
    await withTempDir(async (dir) => {
      const ranklistPath = await copyFixture('conflict.srk.json', dir);
      const server = await startPreviewServer(['preview', '--watch', '--port', '0', dir]);
      try {
        assert.match(server.output().stdout, /Preview watch mode enabled/i);
        const text = await waitForSseEvent(`${server.url}/api/events`, 'ranklist-changed', async () => {
          const ranklist = JSON.parse(await readFile(ranklistPath, 'utf8')) as { contest: { title: string } };
          ranklist.contest.title = 'Changed Contest';
          await writeFile(ranklistPath, JSON.stringify(ranklist), 'utf8');
        });

        assert.match(text, /data: \{"path":"conflict\.srk\.json"\}/);
      } finally {
        await server.stop();
      }
    });
  });

  test('source-mode template lookup requires the built Svelte template', () => {
    const templateUrl = getPreviewTemplateUrl(new URL('../src/rendering/template.ts', import.meta.url));
    assert.ok(templateUrl.href.endsWith('/dist/templates/preview.html'));
  });

  test('preview ranklist enables the problem statistics footer', async () => {
    const source = await readFile(join(repoRoot, 'src', 'web-template', 'App.svelte'), 'utf8');
    assert.match(source, /<Ranklist[\s\S]*\bshowProblemStatisticsFooter\b[\s\S]*\/>/);
  });

  test('preview sidebar places the PR link beside the git changes label', async () => {
    const source = await readFile(join(repoRoot, 'src', 'web-template', 'App.svelte'), 'utf8');
    assert.match(source, /class="file-tree-git-row"[\s\S]*class="file-tree-git-context"[\s\S]*class="file-tree-pr-context"/);
    assert.match(source, /\.file-tree-git-row[\s\S]*justify-content: space-between/);
    assert.match(source, /\.file-tree-git-context[\s\S]*text-overflow: ellipsis/);
    assert.match(source, /\.file-tree-pr-context[\s\S]*flex: 0 0 auto/);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPreviewInit(html: string): {
  mode?: string;
  ranklist?: unknown;
  dataSource?: string;
  dataRoot?: string;
  selectedPath?: string;
  pageTitle?: string;
  prContext?: { number: number; label: string; url: string };
  gitContext?: { summaryLabel?: string };
  tree?: {
    entries: Array<{
      type: string;
      path: string;
      disabled?: boolean;
      gitStatus?: { code: string };
    }>;
  };
} {
  const match = html.match(/window\.__SRK_PREVIEW_INIT__ = (.*?);<\/script>/s);
  assert.ok(match, 'Expected preview init script in HTML');
  return JSON.parse(match[1]);
}

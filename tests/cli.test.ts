import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDir = join(repoRoot, 'tests', 'fixtures');

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
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

describe('srk command', () => {
  test('prints root help', async () => {
    const result = await runCli(['--help']);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage: srk/);
    assert.match(result.stdout, /diagnose/);
    assert.match(result.stdout, /patch/);
  });

  test('prints package version', async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { version: string };
    const result = await runCli(['--version']);

    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), packageJson.version);
  });

  test('prints subcommand help', async () => {
    const diagnose = await runCli(['diagnose', '--help']);
    const patch = await runCli(['patch', '--help']);

    assert.equal(diagnose.code, 0);
    assert.match(diagnose.stdout, /Usage: srk diagnose/);
    assert.match(diagnose.stdout, /--format/);
    assert.match(diagnose.stdout, /--patch/);

    assert.equal(patch.code, 0);
    assert.match(patch.stdout, /Usage: srk patch/);
    assert.match(patch.stdout, /--output/);
    assert.match(patch.stdout, /--in-place/);
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
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

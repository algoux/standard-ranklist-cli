import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), 'srk-cli-pack-'));
const consumerDir = join(tempDir, 'consumer');

try {
  runPnpm(['pack', '--pack-destination', tempDir], { cwd: repoRoot, stdio: 'pipe' });
  const tarballName = readdirSync(tempDir).find((entry) => entry.endsWith('.tgz'));
  assert.ok(tarballName, 'pnpm pack did not create a .tgz file');
  const tarballPath = join(tempDir, tarballName);

  mkdirSync(consumerDir);
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        packageManager: 'pnpm@11.1.3',
        dependencies: {
          '@algoux/standard-ranklist-cli': `file:${normalizeForPnpm(tarballPath)}`,
        },
      },
      null,
      2,
    ),
  );
  runPnpm(['install', '--ignore-scripts'], { cwd: consumerDir, stdio: 'pipe' });

  const installedRoot = join(consumerDir, 'node_modules', '@algoux', 'standard-ranklist-cli');
  const packedPackageJson = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(packedPackageJson.bin.srk, './dist/index.js');

  const binPath = join(installedRoot, packedPackageJson.bin.srk);
  const binText = readFileSync(binPath, 'utf8');
  assert.ok(binText.startsWith('#!/usr/bin/env node'), 'dist/index.js is missing a node shebang');

  const output = runPnpm(['exec', 'srk', '--version'], {
    cwd: consumerDir,
    encoding: 'utf8',
  });
  assert.equal(output.trim(), packedPackageJson.version);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function normalizeForPnpm(path) {
  return path.split(sep).join('/');
}

function runPnpm(args, options) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /\.[cm]?js$/iu.test(npmExecPath)) {
    return execFileSync(process.execPath, [npmExecPath, ...args], options);
  }

  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return execFileSync(command, args, options);
}

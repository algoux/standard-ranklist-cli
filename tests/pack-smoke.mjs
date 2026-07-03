import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  const previewTemplate = readFileSync(join(installedRoot, 'dist', 'templates', 'preview.html'), 'utf8');
  assert.ok(previewTemplate.includes('SRK_PREVIEW_INIT'));
  assert.ok(
    previewTemplate.indexOf('<div id="app"') < previewTemplate.lastIndexOf('<script>'),
    'compiled preview script must run after the #app container exists',
  );
  assert.doesNotMatch(previewTemplate, /\.\$\.root/);
  assert.doesNotMatch(previewTemplate, /\.\$\.callbacks/);
  assert.match(previewTemplate, /root:\w+\.target\|\|\(\w+\?\w+\.\$\$\.root:document\)/);
  assert.doesNotMatch(
    previewTemplate,
    /\.satisfies\(/,
    'compiled preview template must not rely on bundled semver.satisfies for SRK version checks',
  );

  const binPath = join(installedRoot, packedPackageJson.bin.srk);
  const binText = readFileSync(binPath, 'utf8');
  assert.ok(binText.startsWith('#!/usr/bin/env node'), 'dist/index.js is missing a node shebang');

  const output = runPnpm(['exec', 'srk', '--version'], {
    cwd: consumerDir,
    encoding: 'utf8',
  });
  assert.equal(output.trim(), packedPackageJson.version);

  const renderHelp = runPnpm(['exec', 'srk', 'render', '--help'], {
    cwd: consumerDir,
    encoding: 'utf8',
  });
  assert.match(renderHelp, /--static-data-root-url <url>/);

  writeFileSync(join(consumerDir, 'sample.srk.json'), readFileSync(join(repoRoot, 'tests', 'fixtures', 'conflict.srk.json')));
  const validateOutput = runPnpm(['exec', 'srk', 'validate', 'sample.srk.json'], {
    cwd: consumerDir,
    encoding: 'utf8',
  });
  assert.equal(validateOutput, `SRK validation OK: ${realpathSync(join(consumerDir, 'sample.srk.json'))}\n`);

  runPnpm(['exec', 'srk', 'convert', 'excel', 'sample.srk.json', '-o', 'sample.xlsx'], {
    cwd: consumerDir,
    encoding: 'utf8',
  });
  assertZipFile(join(consumerDir, 'sample.xlsx'));

  runPnpm(['exec', 'srk', 'convert', 'gym', 'sample.srk.json', '-o', 'sample.dat'], {
    cwd: consumerDir,
    encoding: 'utf8',
  });
  const dat = readFileSync(join(consumerDir, 'sample.dat'), 'utf8');
  assert.match(dat, /^@contest "Contest"$/m);
  assert.match(dat, /^@problems 1$/m);

  const html = runPnpm(['exec', 'srk', 'render', 'sample.srk.json'], {
    cwd: consumerDir,
    encoding: 'utf8',
  });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /window\.__SRK_PREVIEW_INIT__ = /);
  assert.match(html, /"id":"sample"/);
  assert.doesNotMatch(html, /src="\/assets\//);
  assert.doesNotMatch(html, /href="\/assets\//);

  mkdirSync(join(consumerDir, 'ranklists', 'nested'), { recursive: true });
  writeFileSync(
    join(consumerDir, 'ranklists', 'nested', 'sample.srk.json'),
    readFileSync(join(repoRoot, 'tests', 'fixtures', 'conflict.srk.json')),
  );
  runPnpm(['exec', 'srk', 'render', '-o', 'rendered-site', 'ranklists'], {
    cwd: consumerDir,
    encoding: 'utf8',
  });
  const directoryHtml = readFileSync(join(consumerDir, 'rendered-site', 'index.html'), 'utf8');
  assert.match(directoryHtml, /"mode":"directory"/);
  assert.match(directoryHtml, /"dataSource":"static"/);
  assert.equal(
    readFileSync(join(consumerDir, 'rendered-site', 'data', 'nested', 'sample.srk.json'), 'utf8'),
    readFileSync(join(consumerDir, 'ranklists', 'nested', 'sample.srk.json'), 'utf8'),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function normalizeForPnpm(path) {
  return path.split(sep).join('/');
}

function assertZipFile(path) {
  const output = readFileSync(path);
  assert.ok(output.length > 0, 'expected a non-empty zip file');
  assert.equal(output.subarray(0, 2).toString('utf8'), 'PK');
}

function runPnpm(args, options) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /\.[cm]?js$/iu.test(npmExecPath)) {
    return execFileSync(process.execPath, [npmExecPath, ...args], options);
  }

  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return execFileSync(command, args, options);
}

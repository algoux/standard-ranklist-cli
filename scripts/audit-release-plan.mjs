import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const failures = [];

function fail(message) {
  failures.push(message);
}

async function readText(path) {
  return readFile(new URL(path, root), 'utf8');
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

const packageJson = await readJson('package.json');

if (packageJson.name !== '@algoux/standard-ranklist-cli') {
  fail('package name must be @algoux/standard-ranklist-cli');
}
if (packageJson.type !== 'module') {
  fail('package must be ESM-only with type: module');
}
if (packageJson.bin?.srk !== './dist/index.js') {
  fail('bin.srk must point to ./dist/index.js');
}
if (packageJson.engines?.node !== '>=22') {
  fail('engines.node must be >=22');
}
if (packageJson.dependencies?.['@algoux/standard-ranklist-utils']?.startsWith('file:')) {
  fail('utils dependency must not use file: before release');
}
if (packageJson.dependencies?.['@algoux/standard-ranklist-utils']?.startsWith('link:')) {
  fail('utils dependency must not use link: before release');
}

const expectedFiles = ['dist', 'README.md', 'LICENSE'];
if (JSON.stringify(packageJson.files) !== JSON.stringify(expectedFiles)) {
  fail(`package files must be exactly ${expectedFiles.join(', ')}`);
}

const workspaceYaml = await readText('pnpm-workspace.yaml');
if (
  process.env.ALLOW_LOCAL_UTILS_DEP !== '1' &&
  /@algoux\/standard-ranklist-utils['"]?:\s*link:/u.test(workspaceYaml)
) {
  fail('remove the temporary local @algoux/standard-ranklist-utils link before publishing');
}

const changesetConfig = await readJson('.changeset/config.json');
if (changesetConfig.access !== 'public') {
  fail('changesets access must be public');
}
if (changesetConfig.baseBranch !== 'main') {
  fail('changesets baseBranch must be main');
}

for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  const text = await readText(workflow);
  if (/NPM_TOKEN|NODE_AUTH_TOKEN/u.test(text)) {
    fail(`${workflow} must not use token-based npm publishing`);
  }
}

const releaseWorkflow = await readText('.github/workflows/release.yml');
if (!/id-token:\s*write/u.test(releaseWorkflow)) {
  fail('release workflow must grant id-token: write for npm Trusted Publishing');
}

const changesetFiles = (await readdir(new URL('.changeset', root))).filter(
  (file) => file.endsWith('.md') && file !== 'README.md',
);
for (const file of changesetFiles) {
  const text = await readFile(join(new URL('.changeset', root).pathname, file), 'utf8');
  if (!text.includes('"@algoux/standard-ranklist-cli"')) {
    fail(`changeset ${file} must target @algoux/standard-ranklist-cli`);
  }
}

if (failures.length) {
  console.error('Release audit failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Release audit passed.');

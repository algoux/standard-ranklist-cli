#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { createDiagnoseCommand } from './commands/diagnose.js';
import { createPatchCommand } from './commands/patch.js';
import { createPreviewCommand } from './commands/preview.js';
import { createRenderCommand } from './commands/render.js';
import { printCliError } from './utils/errors.js';

function readPackageVersion(): string {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as { version?: string };
  return packageJson.version ?? '0.0.0';
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('srk')
    .description('Command-line workflows for Standard Ranklist files.')
    .version(readPackageVersion(), '-v, --version', 'print the srk CLI version')
    .showHelpAfterError()
    .showSuggestionAfterError();

  program.addCommand(createDiagnoseCommand());
  program.addCommand(createPatchCommand());
  program.addCommand(createPreviewCommand());
  program.addCommand(createRenderCommand());

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    process.exitCode = printCliError(error);
  }
}

function resolveEntrypointUrl(entrypointPath: string | undefined): string | undefined {
  if (!entrypointPath) {
    return undefined;
  }

  try {
    return pathToFileURL(realpathSync(entrypointPath)).href;
  } catch {
    return pathToFileURL(entrypointPath).href;
  }
}

const entrypointUrl = resolveEntrypointUrl(process.argv[1]);
if (entrypointUrl === import.meta.url) {
  void main();
}

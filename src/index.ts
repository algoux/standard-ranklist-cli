#!/usr/bin/env node
import { readFileSync } from 'node:fs';
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

const entrypointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entrypointUrl === import.meta.url) {
  void main();
}

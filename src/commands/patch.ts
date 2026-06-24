import { Command } from 'commander';
import { CliError } from '../utils/errors.js';
import { readJsonFile, stringifyJson, writeJsonFile } from '../utils/files.js';

interface PatchOptions {
  output?: string;
  inPlace?: boolean;
}

export function createPatchCommand(): Command {
  const command = new Command('patch');

  command
    .description('apply an srk patch file to an explicit Standard Ranklist JSON file')
    .argument('<ranklist.json>', 'ranklist JSON file to patch')
    .argument('<patch.json>', 'srk patch JSON file to apply')
    .option('-o, --output <fixed.json>', 'write patched ranklist JSON to a file')
    .option('--in-place', 'overwrite the input ranklist JSON file')
    .action(async (ranklistPath: string, patchPath: string, options: PatchOptions) => {
      await runPatch(ranklistPath, patchPath, options);
    });

  return command;
}

async function runPatch(ranklistPath: string, patchPath: string, options: PatchOptions): Promise<void> {
  if (options.output && options.inPlace) {
    throw new CliError('--output and --in-place cannot be combined.');
  }

  const ranklist = await readJsonFile(ranklistPath, 'ranklist');
  const patch = await readJsonFile(patchPath, 'patch');
  const { patchRanklist } = await import('@algoux/standard-ranklist-utils');

  let patched: unknown;
  try {
    patched = patchRanklist(ranklist as never, patch as never);
  } catch (error) {
    throw CliError.from(error, 'Unable to apply patch');
  }

  if (options.inPlace) {
    await writeJsonFile(ranklistPath, patched, 'ranklist');
    return;
  }

  if (options.output) {
    await writeJsonFile(options.output, patched, 'ranklist');
    return;
  }

  process.stdout.write(stringifyJson(patched));
}

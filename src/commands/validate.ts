import { resolve } from 'node:path';
import { Command } from 'commander';
import { formatSrkSchemaValidationErrors, validateSrkSchema } from '../validation/srk-schema.js';
import { CliError } from '../utils/errors.js';
import { readJsonFile } from '../utils/files.js';

export function createValidateCommand(): Command {
  const command = new Command('validate');

  command
    .description('validate a Standard Ranklist JSON file against the schema')
    .argument('<srk.json>', 'ranklist JSON file to validate')
    .action(async (ranklistPath: string) => {
      await runValidate(ranklistPath);
    });

  return command;
}

async function runValidate(ranklistPath: string): Promise<void> {
  const absoluteRanklistPath = resolve(process.cwd(), ranklistPath);
  const ranklist = await readJsonFile(absoluteRanklistPath, 'ranklist');
  const errors = validateSrkSchema(ranklist);
  if (errors.length > 0) {
    throw new CliError(
      `SRK validation failed: ${absoluteRanklistPath}\n${formatSrkSchemaValidationErrors(errors)}`,
    );
  }

  process.stdout.write(`SRK validation OK: ${absoluteRanklistPath}\n`);
}

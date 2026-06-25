import { Command } from 'commander';
import { resolve } from 'node:path';
import type { RanklistDiagnostics } from '@algoux/standard-ranklist-utils';
import { formatDiagnosticsText } from '../formatters/diagnostics-text.js';
import { CliError } from '../utils/errors.js';
import { readJsonFile, writeJsonFile, writeStdoutJson } from '../utils/files.js';

type DiagnoseFormat = 'text' | 'json';

interface DiagnoseOptions {
  format: DiagnoseFormat;
  patch?: string;
}

export function createDiagnoseCommand(): Command {
  const command = new Command('diagnose');

  command
    .description('diagnose an explicit Standard Ranklist JSON file')
    .argument('<srk.json>', 'ranklist JSON file to inspect')
    .option('-f, --format <format>', 'output format: text or json', 'text')
    .option('-p, --patch <patch.json>', 'write a generated srk patch file')
    .action(async (ranklistPath: string, options: DiagnoseOptions) => {
      await runDiagnose(ranklistPath, options);
    });

  return command;
}

async function runDiagnose(ranklistPath: string, options: DiagnoseOptions): Promise<void> {
  const format = normalizeFormat(options.format);
  const absoluteRanklistPath = resolve(process.cwd(), ranklistPath);
  const ranklist = await readJsonFile(absoluteRanklistPath, 'ranklist');
  const { createRanklistPatchFromDiagnostics, diagnoseRanklist } = await import('@algoux/standard-ranklist-utils');

  let diagnostics: RanklistDiagnostics;
  try {
    diagnostics = diagnoseRanklist(ranklist as never);
  } catch (error) {
    throw CliError.from(error, 'Unable to diagnose ranklist');
  }

  if (options.patch) {
    const patch = createRanklistPatchFromDiagnostics(ranklist as never, diagnostics);
    await writeJsonFile(options.patch, patch, 'patch');
  }

  if (format === 'json') {
    writeStdoutJson(diagnostics);
    return;
  }

  process.stdout.write(formatDiagnosticsText(diagnostics, absoluteRanklistPath));
}

function normalizeFormat(format: string): DiagnoseFormat {
  const normalized = format.toLowerCase();
  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }
  throw new CliError(`Unsupported diagnose format "${format}". Expected "text" or "json".`);
}

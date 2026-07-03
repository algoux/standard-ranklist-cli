import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { formatSrkSchemaValidationErrors, validateSrkSchema } from '../validation/srk-schema.js';
import { CliError } from '../utils/errors.js';
import { readJsonFile } from '../utils/files.js';

const supportedFormats = ['excel', 'vjudge', 'gym'] as const;

type ConvertFormat = (typeof supportedFormats)[number];

interface ConvertOptions {
  output: string;
}

export function createConvertCommand(): Command {
  const command = new Command('convert');

  command
    .description('convert a Standard Ranklist JSON file to another ranklist format')
    .argument('<format>', 'output format: excel, vjudge, or gym')
    .argument('<srk.json>', 'ranklist JSON file to convert')
    .requiredOption('-o, --output <output>', 'write converted output to a file')
    .action(async (format: string, ranklistPath: string, options: ConvertOptions) => {
      await runConvert(format, ranklistPath, options);
    });

  return command;
}

async function runConvert(format: string, ranklistPath: string, options: ConvertOptions): Promise<void> {
  const normalizedFormat = normalizeFormat(format);
  if (isWorkbookFormat(normalizedFormat) && !options.output.toLowerCase().endsWith('.xlsx')) {
    throw new CliError(`Convert format "${normalizedFormat}" requires an .xlsx output path.`);
  }

  const absoluteRanklistPath = resolve(process.cwd(), ranklistPath);
  const ranklist = await readJsonFile(absoluteRanklistPath, 'ranklist');
  const errors = validateSrkSchema(ranklist);
  if (errors.length > 0) {
    throw new CliError(
      `SRK validation failed: ${absoluteRanklistPath}\n${formatSrkSchemaValidationErrors(errors)}`,
    );
  }

  const {
    CodeforcesGymGhostDATConverter,
    GeneralExcelConverter,
    VJudgeReplayConverter,
  } = await import('@algoux/standard-ranklist-convert-to');

  if (normalizedFormat === 'excel') {
    new GeneralExcelConverter().convertAndWrite(ranklist as never, options.output);
    return;
  }

  if (normalizedFormat === 'vjudge') {
    new VJudgeReplayConverter().convertAndWrite(ranklist as never, options.output);
    return;
  }

  const result = new CodeforcesGymGhostDATConverter().convert(ranklist as never);
  await writeFile(options.output, result.content, 'utf8');
}

function normalizeFormat(format: string): ConvertFormat {
  const normalized = format.toLowerCase();
  if (isConvertFormat(normalized)) {
    return normalized;
  }
  throw new CliError(`Unsupported convert format "${format}". Expected "excel", "vjudge", or "gym".`);
}

function isConvertFormat(format: string): format is ConvertFormat {
  return (supportedFormats as readonly string[]).includes(format);
}

function isWorkbookFormat(format: ConvertFormat): format is 'excel' | 'vjudge' {
  return format === 'excel' || format === 'vjudge';
}

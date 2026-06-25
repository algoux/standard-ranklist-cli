import { Command } from 'commander';
import { startPreviewServer, previewDefaults } from '../preview/server.js';
import { CliError } from '../utils/errors.js';

interface PreviewOptions {
  watch?: boolean;
  host?: string;
  port: string;
  open?: boolean;
  srkAssetBase: string;
  gitDiffBase?: string;
  gitDiffHead?: string;
}

export function createPreviewCommand(): Command {
  const command = new Command('preview');

  command
    .description('start a local preview server for a Standard Ranklist JSON file or directory')
    .helpOption('--help', 'display help for command')
    .argument('<path>', 'ranklist JSON file or directory to preview')
    .option('-w, --watch', 'watch the file or directory and notify the preview page')
    .option('-h, --host <host>', 'preview server listen host; omit to expose on detected local and network interfaces')
    .option('-p, --port <port>', 'preview server listen port', String(previewDefaults.port))
    .option('--open', 'open the preview URL in the default browser')
    .option('--srk-asset-base <url>', 'base URL for relative SRK assets', previewDefaults.srkAssetBase)
    .option('--git-diff-base <ref>', 'show only SRK files changed in the git diff from this base ref')
    .option('--git-diff-head <ref>', 'git diff head ref for --git-diff-base', 'HEAD')
    .action(async (path: string, options: PreviewOptions) => {
      const portWasSpecified = command.getOptionValueSource('port') === 'cli';
      await startPreviewServer({
        inputPath: path,
        host: options.host,
        port: parsePort(options.port),
        portWasSpecified,
        open: Boolean(options.open),
        watch: Boolean(options.watch),
        srkAssetBase: options.srkAssetBase,
        gitDiffBase: options.gitDiffBase,
        gitDiffHead: options.gitDiffBase ? options.gitDiffHead : undefined,
      });
    });

  return command;
}

function parsePort(port: string): number {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new CliError(`Invalid preview port "${port}". Expected an integer from 0 to 65535.`);
  }
  return value;
}

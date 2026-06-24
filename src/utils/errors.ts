export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }

  static from(error: unknown, prefix: string): CliError {
    return new CliError(`${prefix}: ${getErrorMessage(error)}`);
  }
}

export function printCliError(error: unknown): number {
  if (error instanceof CliError) {
    process.stderr.write(`srk: ${error.message}\n`);
    return error.exitCode;
  }

  process.stderr.write(`srk: ${getErrorMessage(error)}\n`);
  return 1;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

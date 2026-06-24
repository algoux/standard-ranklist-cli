import { readFile, writeFile } from 'node:fs/promises';
import { CliError, getErrorMessage } from './errors.js';

export async function readJsonFile(path: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new CliError(`Unable to read ${label} "${path}": ${getErrorMessage(error)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`Invalid JSON in ${label} "${path}": ${getErrorMessage(error)}`);
  }
}

export async function writeJsonFile(path: string, data: unknown, label: string): Promise<void> {
  try {
    await writeFile(path, stringifyJson(data), 'utf8');
  } catch (error) {
    throw new CliError(`Unable to write ${label} "${path}": ${getErrorMessage(error)}`);
  }
}

export function writeStdoutJson(data: unknown): void {
  process.stdout.write(stringifyJson(data));
}

export function stringifyJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

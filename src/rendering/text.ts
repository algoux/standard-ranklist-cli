import type { Text } from '@algoux/standard-ranklist';
import { resolveText } from '@algoux/standard-ranklist-utils';

export function resolveOptionalText(value: Text | null | undefined, languages?: readonly string[]): string {
  if (value === null || value === undefined) {
    return '';
  }
  return resolveText(value, languages);
}

export function collectI18nLanguages(value: unknown): string[] {
  const languages: string[] = [];
  const seen = new Set<string>();
  collectI18nLanguagesInto(value, languages, seen, new Set<unknown>());
  return languages;
}

function collectI18nLanguagesInto(
  value: unknown,
  languages: string[],
  seenLanguages: Set<string>,
  seenValues: Set<unknown>,
): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (seenValues.has(value)) {
    return;
  }
  seenValues.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectI18nLanguagesInto(item, languages, seenLanguages, seenValues);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.fallback === 'string') {
    for (const [key, text] of Object.entries(record)) {
      if (key === 'fallback' || typeof text !== 'string' || seenLanguages.has(key)) {
        continue;
      }
      seenLanguages.add(key);
      languages.push(key);
    }
  }

  for (const child of Object.values(record)) {
    collectI18nLanguagesInto(child, languages, seenLanguages, seenValues);
  }
}

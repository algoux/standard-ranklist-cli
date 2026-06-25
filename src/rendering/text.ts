import type { Text } from '@algoux/standard-ranklist';
import { resolveText } from '@algoux/standard-ranklist-utils';

export function resolveOptionalText(value: Text | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return resolveText(value);
}

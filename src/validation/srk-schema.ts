import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Ajv as AjvInstance, AnySchema, ErrorObject, Options, ValidateFunction } from 'ajv';
import type { FormatsPlugin } from 'ajv-formats';

export interface SrkSchemaValidationError {
  path: string;
  message: string;
  keyword: string;
}

let validateRanklist: ValidateFunction | null = null;
const requireModule = createRequire(import.meta.url);
const AjvConstructor = requireModule('ajv') as new (options?: Options) => AjvInstance;
const addFormats = requireModule('ajv-formats') as FormatsPlugin;

export function validateSrkSchema(data: unknown): SrkSchemaValidationError[] {
  const validate = getRanklistValidator();
  if (validate(data)) {
    return [];
  }
  return formatAjvErrors(validate.errors ?? []);
}

export function formatSrkSchemaValidationErrors(errors: SrkSchemaValidationError[]): string {
  return errors.map((error) => `  - ${error.path}: ${error.message}`).join('\n');
}

function getRanklistValidator(): ValidateFunction {
  if (validateRanklist) {
    return validateRanklist;
  }

  const ajv = new AjvConstructor({ allErrors: true, strict: false });
  addFormats(ajv);
  const compiled = ajv.compile(loadRelaxedRanklistSchema());
  validateRanklist = compiled;
  return compiled;
}

function loadRelaxedRanklistSchema(): AnySchema {
  const schemaPath = requireModule.resolve('@algoux/standard-ranklist/schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as unknown;
  return allowUnknownObjectFields(schema) as AnySchema;
}

function allowUnknownObjectFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => allowUnknownObjectFields(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'additionalProperties' && child === false) {
      continue;
    }
    result[key] = allowUnknownObjectFields(child);
  }
  return result;
}

function formatAjvErrors(errors: ErrorObject[]): SrkSchemaValidationError[] {
  return errors.map((error) => ({
    path: formatErrorPath(error),
    message: error.message ?? `failed schema keyword "${error.keyword}"`,
    keyword: error.keyword,
  }));
}

function formatErrorPath(error: ErrorObject): string {
  if (error.keyword === 'required' && isRecord(error.params) && typeof error.params.missingProperty === 'string') {
    return appendJsonPointerSegment(error.instancePath, error.params.missingProperty);
  }
  return error.instancePath || '/';
}

function appendJsonPointerSegment(path: string, segment: string): string {
  const escapedSegment = segment.replace(/~/gu, '~0').replace(/\//gu, '~1');
  return `${path || ''}/${escapedSegment}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

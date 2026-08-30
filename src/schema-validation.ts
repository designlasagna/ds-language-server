import type { ErrorObject, ValidateFunction } from 'ajv';
import { createRequire } from 'node:module';
import { detectTokenDocumentFormat, type TokenDocumentFormat } from './token-document.js';

const require = createRequire(import.meta.url);
const Ajv = require('ajv') as typeof import('ajv').default;
const addFormats = require('ajv-formats') as typeof import('ajv-formats').default;

const manifestSchema = require('@designlasagna/schemas/v0.3/tokens.json') as object;
const dtcgSchema = require('@designlasagna/schemas/dtcg/2025.10/format.json') as object;
const extensionSchema = require('@designlasagna/schemas/v0.3/dtcg-extensions.json') as {
  $id: string;
};
const extensionNamespace = 'recipes.designlasagna';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(extensionSchema);

const validateManifest = ajv.compile(manifestSchema);
const validateDtcg = ajv.compile(dtcgSchema);
const validateTokenExtension = ajv.compile({
  $ref: `${extensionSchema.$id}#/definitions/TokenExtensions`,
});
const validateGroupExtension = ajv.compile({
  $ref: `${extensionSchema.$id}#/definitions/GroupExtensions`,
});

export interface TokenDocumentValidationError {
  format: TokenDocumentFormat;
  schema: 'manifest' | 'dtcg' | 'designlasagna-extension';
  instancePath: string;
  keyword: string;
  message: string;
}

/**
 * Validate one parsed JSON token document. DTCG documents are valid without a
 * Design Lasagna extension; the extension schema is applied only when its
 * namespace is present.
 */
export function validateTokenDocument(document: unknown): TokenDocumentValidationError[] {
  const format = detectTokenDocumentFormat(document);
  if (format === 'unknown') {
    return [{
      format,
      schema: 'dtcg',
      instancePath: '',
      keyword: 'type',
      message: 'Token documents must have an object at the root.',
    }];
  }

  if (format === 'manifest') {
    validateManifest(document);
    return toErrors(validateManifest, format, 'manifest');
  }

  validateDtcg(document);
  return [
    ...toErrors(validateDtcg, format, 'dtcg'),
    ...validateDesignLasagnaExtensions(document, ''),
  ];
}

function validateDesignLasagnaExtensions(
  value: unknown,
  path: string,
): TokenDocumentValidationError[] {
  if (!isRecord(value)) return [];

  const errors: TokenDocumentValidationError[] = [];
  const extensions = value.$extensions;
  if (isRecord(extensions) && extensionNamespace in extensions) {
    const validate = isToken(value) ? validateTokenExtension : validateGroupExtension;
    validate(extensions[extensionNamespace]);
    errors.push(...toErrors(
      validate,
      'dtcg',
      'designlasagna-extension',
      `${path}/$extensions/${escapePointerSegment(extensionNamespace)}`,
    ));
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$')) continue;
    errors.push(...validateDesignLasagnaExtensions(child, `${path}/${escapePointerSegment(key)}`));
  }
  return errors;
}

function toErrors(
  validate: ValidateFunction,
  format: TokenDocumentFormat,
  schema: TokenDocumentValidationError['schema'],
  prefix = '',
): TokenDocumentValidationError[] {
  return (validate.errors ?? []).map((error: ErrorObject) => ({
    format,
    schema,
    instancePath: `${prefix}${error.instancePath}`,
    keyword: error.keyword,
    message: error.message ?? 'is invalid',
  }));
}

function isToken(value: Record<string, unknown>): boolean {
  return '$value' in value || typeof value.$ref === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

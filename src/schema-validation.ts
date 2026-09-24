import type { ErrorObject, ValidateFunction } from 'ajv';
import { createRequire } from 'node:module';
import { detectTokenDocumentFormat, type TokenDocumentFormat } from './token-document.js';

const require = createRequire(import.meta.url);
const Ajv = require('ajv') as typeof import('ajv').default;
const addFormats = require('ajv-formats') as typeof import('ajv-formats').default;

const manifestSchema = require('@designlasagna/schemas/v0.3/tokens.json') as object;
const manifestV04Schema = require('@designlasagna/schemas/v0.4/tokens.json') as object;
const lifecycleSchema = require('@designlasagna/schemas/v0.4/lifecycle.json') as object;
const dtcgSchema = require('@designlasagna/schemas/dtcg/2025.10/format.json') as object;
const extensionSchema = require('@designlasagna/schemas/v0.3/dtcg-extensions.json') as {
  $id: string;
};
const extensionV04Schema = require('@designlasagna/schemas/v0.4/dtcg-extensions.json') as {
  $id: string;
};
const extensionNamespace = 'recipes.designlasagna';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
// The v0.4 tokens and extension schemas both $ref lifecycle.json, so the
// lifecycle and extension schemas must be registered before compiling.
ajv.addSchema(extensionSchema);
ajv.addSchema(lifecycleSchema);
ajv.addSchema(extensionV04Schema);

const validateManifest = ajv.compile(manifestSchema);
const validateManifestV04 = ajv.compile(manifestV04Schema);
const validateDtcg = ajv.compile(dtcgSchema);
const validateTokenExtension = ajv.compile({
  $ref: `${extensionSchema.$id}#/definitions/TokenExtensions`,
});
const validateGroupExtension = ajv.compile({
  $ref: `${extensionSchema.$id}#/definitions/GroupExtensions`,
});
const validateTokenExtensionV04 = ajv.compile({
  $ref: `${extensionV04Schema.$id}#/definitions/TokenExtensions`,
});
const validateGroupExtensionV04 = ajv.compile({
  $ref: `${extensionV04Schema.$id}#/definitions/GroupExtensions`,
});

/**
 * Lifecycle profile for DTCG extension validation. `'0.4'` selects the v0.4
 * extension schema; the absence of a profile keeps the v0.3 behavior.
 */
export type LifecycleProfile = '0.4';

export interface TokenDocumentValidationError {
  format: TokenDocumentFormat;
  schema: 'manifest' | 'dtcg' | 'designlasagna-extension';
  instancePath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}

/**
 * Validate one parsed JSON token document. DTCG documents are valid without a
 * Design Lasagna extension; the extension schema is applied only when its
 * namespace is present. Manifest documents pick the v0.4 schema when they
 * declare `schemaVersion: '0.4.0'`; `lifecycleProfile` selects the v0.4 DTCG
 * extension schema when `'0.4'`.
 */
export function validateTokenDocument(
  document: unknown,
  lifecycleProfile?: LifecycleProfile,
): TokenDocumentValidationError[] {
  const format = detectTokenDocumentFormat(document);
  if (format === 'unknown') {
    return [{
      format,
      schema: 'dtcg',
      instancePath: '',
      keyword: 'type',
      message: 'Token documents must have an object at the root.',
      params: {},
    }];
  }

  if (format === 'manifest') {
    const validate = isRecord(document) && document.schemaVersion === '0.4.0'
      ? validateManifestV04
      : validateManifest;
    validate(document);
    return toErrors(validate, format, 'manifest');
  }

  validateDtcg(document);
  return [
    ...toErrors(validateDtcg, format, 'dtcg'),
    ...validateDesignLasagnaExtensions(document, '', lifecycleProfile),
  ];
}

function validateDesignLasagnaExtensions(
  value: unknown,
  path: string,
  lifecycleProfile?: LifecycleProfile,
): TokenDocumentValidationError[] {
  if (!isRecord(value)) return [];

  const errors: TokenDocumentValidationError[] = [];
  const extensions = value.$extensions;
  if (isRecord(extensions) && extensionNamespace in extensions) {
    const useV04 = lifecycleProfile === '0.4';
    const validate = isToken(value)
      ? useV04 ? validateTokenExtensionV04 : validateTokenExtension
      : useV04 ? validateGroupExtensionV04 : validateGroupExtension;
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
    errors.push(...validateDesignLasagnaExtensions(
      child,
      `${path}/${escapePointerSegment(key)}`,
      lifecycleProfile,
    ));
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
    params: error.params,
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

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'jsonc-parser';

export type ManifestKind = 'tokens' | 'utilities' | 'icons';

type JsonSchema = Record<string, unknown>;
type Path = (string | number)[];

// The known field names come from the published v0.4 schemas, so they stay in
// sync with the package instead of a hand-maintained list.
const require = createRequire(import.meta.url);
const lifecycleSchema = require('@designlasagna/schemas/v0.4/lifecycle.json') as JsonSchema;
const rootSchemas: Record<ManifestKind, JsonSchema> = {
  tokens: require('@designlasagna/schemas/v0.4/tokens.json') as JsonSchema,
  utilities: require('@designlasagna/schemas/v0.4/utilities.json') as JsonSchema,
  icons: require('@designlasagna/schemas/v0.4/icons.json') as JsonSchema,
};
const siblingDocuments: Record<string, JsonSchema> = { 'lifecycle.json': lifecycleSchema };

/** A schema together with the document its local `$ref`s resolve against. */
interface Scoped { schema: JsonSchema; document: JsonSchema }

const MAX_LISTED = 10;

/**
 * Schemas are open: unknown fields are never problems, and are never reported
 * as diagnostics. This lists them (e.g. `tokens["color.bg"].foo`) so the
 * server can log what it does not use. Only native v0.4 manifests are
 * inspected; `metadata`, platform keys, value maps and other deliberately open
 * objects are skipped.
 */
export function collectUnknownFields(value: unknown, kind: ManifestKind): string[] {
  if (!isRecord(value) || value.schemaVersion !== '0.4.0') return [];
  const found: string[] = [];
  const schema = rootSchemas[kind];
  walk(kind, value, { schema, document: schema }, [], '', found);
  return found;
}

/** One log line for a manifest's unknown fields, or undefined when there are none. */
export function formatUnknownFieldsLog(displayPath: string, fields: string[]): string | undefined {
  if (!fields.length) return undefined;
  const shown = fields.slice(0, MAX_LISTED).join(', ');
  const more = fields.length > MAX_LISTED ? ` and ${fields.length - MAX_LISTED} more` : '';
  return `[manifest] ${displayPath}: fields not used by the language server: ${shown}${more}`;
}

/** Reads a manifest file and returns its log line; unreadable or unparseable files yield nothing. */
export function unknownFieldsLogLine(filePath: string, kind: ManifestKind, workspaceRoot: string): string | undefined {
  try {
    const value = parse(fs.readFileSync(filePath, 'utf8'), [], { allowTrailingComma: true });
    const relative = path.relative(workspaceRoot, filePath);
    return formatUnknownFieldsLog(relative.startsWith('..') ? filePath : relative, collectUnknownFields(value, kind));
  } catch {
    return undefined;
  }
}

function label(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function walk(kind: ManifestKind, value: unknown, scoped: Scoped, path: Path, label_: string, found: string[]): void {
  const resolved = resolveObjectSchema(scoped);
  if (Array.isArray(value)) {
    const items = resolved?.items ?? itemsOf(scoped);
    if (!items) return;
    value.forEach((item, index) => {
      const id = isRecord(item) ? (typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : undefined) : undefined;
      walk(kind, item, items, [...path, index], `${label_}${id !== undefined ? `[${JSON.stringify(id)}]` : `[${index}]`}`, found);
    });
    return;
  }
  if (!isRecord(value) || !resolved) return;

  const additional = resolved.additionalProperties;
  const reportUnknown = resolved.hasProperties && additional === undefined && !isOpenByDesign(kind, path);

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    const childLabel = label(label_, key);
    const known = resolved.properties.get(key);
    if (known) {
      walk(kind, child, known, childPath, childLabel, found);
    } else if (additional && typeof additional === 'object') {
      walk(kind, child, { schema: additional as JsonSchema, document: resolved.document }, childPath, childLabel, found);
    } else if (reportUnknown) {
      found.push(childLabel);
    }
  }
}

/**
 * Objects whose extra keys are part of the design: utility variant kinds and
 * the patterns that name them.
 */
function isOpenByDesign(kind: ManifestKind, path: Path): boolean {
  if (kind !== 'utilities') return false;
  const last = path[path.length - 1];
  return last === 'variantPatterns' || last === 'variants';
}

// ─── Schema resolution ─────────────────────────────────────────────

interface ResolvedObject {
  properties: Map<string, Scoped>;
  hasProperties: boolean;
  additionalProperties: unknown;
  document: JsonSchema;
  items?: Scoped;
}

function deref(scoped: Scoped): Scoped {
  let current = scoped;
  for (let depth = 0; depth < 20 && typeof current.schema.$ref === 'string'; depth++) {
    const [file, pointer] = current.schema.$ref.split('#');
    const document = file ? siblingDocuments[file] : current.document;
    if (!document) return { schema: {}, document: current.document };
    let node: unknown = document;
    for (const segment of (pointer ?? '').split('/').filter(Boolean)) {
      node = isRecord(node) ? node[segment] : undefined;
    }
    current = { schema: isRecord(node) ? node : {}, document };
  }
  return current;
}

/**
 * Merge `properties` across `allOf` (local and sibling-document definitions).
 * `oneOf`/`anyOf` contribute only when exactly one branch describes an object,
 * so ambiguous unions never produce guesses.
 */
function resolveObjectSchema(scoped: Scoped): ResolvedObject | undefined {
  const { schema, document } = deref(scoped);
  const result: ResolvedObject = {
    properties: new Map(),
    hasProperties: false,
    additionalProperties: schema.additionalProperties,
    document,
  };
  if (isRecord(schema.properties)) {
    result.hasProperties = true;
    for (const [name, child] of Object.entries(schema.properties)) {
      if (isRecord(child)) result.properties.set(name, { schema: child, document });
    }
  }
  if (isRecord(schema.items)) result.items = { schema: schema.items, document };

  for (const part of Array.isArray(schema.allOf) ? schema.allOf : []) {
    if (!isRecord(part)) continue;
    const merged = resolveObjectSchema({ schema: part, document });
    if (!merged) continue;
    result.hasProperties ||= merged.hasProperties;
    for (const [name, child] of merged.properties) result.properties.set(name, child);
    if (result.additionalProperties === undefined) result.additionalProperties = merged.additionalProperties;
    result.items ??= merged.items;
  }

  const branches = [...(Array.isArray(schema.oneOf) ? schema.oneOf : []), ...(Array.isArray(schema.anyOf) ? schema.anyOf : [])]
    .filter(isRecord)
    .map((branch) => resolveObjectSchema({ schema: branch, document }))
    .filter((branch): branch is ResolvedObject => branch !== undefined && (branch.hasProperties || branch.additionalProperties !== undefined));
  if (branches.length === 1 && !result.hasProperties) {
    const [only] = branches;
    return { ...only, items: result.items ?? only.items };
  }
  return result;
}

function itemsOf(scoped: Scoped): Scoped | undefined {
  const { schema, document } = deref(scoped);
  return isRecord(schema.items) ? { schema: schema.items, document } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

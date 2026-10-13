import { createRequire } from 'node:module';
import {
  DiagnosticSeverity,
  type Diagnostic,
  type Range,
} from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  findNodeAtLocation,
  parse,
  parseTree,
  type Node as JsonNode,
} from 'jsonc-parser';
import { isRecognisedRemoval } from '../lifecycle.js';

const SOURCE = 'designlasagna-schema';

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

interface WalkContext {
  kind: ManifestKind;
  document: TextDocument;
  root: JsonNode;
  variantPatterns: Set<string>;
  diagnostics: Diagnostic[];
}

/**
 * Warnings for native v0.4 manifests: unknown fields, unrecognised `removal`
 * formats, undeclared utility variant kinds and valid-but-suspicious values.
 * Schemas stay open, so none of these is an error and none blocks loading.
 * Returns nothing for unparseable documents (the caller reports those) and for
 * manifests that do not declare `schemaVersion: '0.4.0'`.
 */
export function getManifestWarnings(document: TextDocument, kind: ManifestKind): Diagnostic[] {
  const text = document.getText();
  const errors: unknown[] = [];
  const value = parse(text, errors as never[], { allowTrailingComma: true, disallowComments: false });
  const root = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0 || !root) return [];
  return collectManifestWarnings(document, root, value, kind);
}

/** As {@link getManifestWarnings}, for callers that already parsed the document. */
export function collectManifestWarnings(
  document: TextDocument,
  root: JsonNode,
  value: unknown,
  kind: ManifestKind,
): Diagnostic[] {
  if (!isRecord(value) || value.schemaVersion !== '0.4.0') return [];
  const context: WalkContext = {
    kind,
    document,
    root,
    variantPatterns: new Set(isRecord(value.variantPatterns) ? Object.keys(value.variantPatterns) : []),
    diagnostics: [],
  };
  const schema = rootSchemas[kind];
  walk(context, value, { schema, document: schema }, []);
  return context.diagnostics;
}

function walk(context: WalkContext, value: unknown, scoped: Scoped, path: Path): void {
  const resolved = resolveObjectSchema(scoped);
  if (Array.isArray(value)) {
    const items = resolved?.items ?? itemsOf(scoped);
    if (items) value.forEach((item, index) => walk(context, item, items, [...path, index]));
    return;
  }
  if (!isRecord(value) || !resolved) return;

  const additional = resolved.additionalProperties;
  const warnUnknown = resolved.hasProperties && additional === undefined && !isOpenByDesign(context.kind, path);

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    const known = resolved.properties.get(key);
    if (known) {
      checkValue(context, key, child, childPath);
      walk(context, child, known, childPath);
    } else if (additional && typeof additional === 'object') {
      walk(context, child, { schema: additional as JsonSchema, document: resolved.document }, childPath);
    } else if (warnUnknown) {
      warnUnknownField(context, key, childPath, resolved.properties);
    }
  }
}

/** Value-level checks attached to a known field. */
function checkValue(context: WalkContext, key: string, value: unknown, path: Path): void {
  if (key === 'deprecated' && isRecord(value) && typeof value.removal === 'string'
      && !isRecognisedRemoval(value.removal)) {
    report(context, [...path, 'removal'], 'invalid-removal',
      '`removal` isn\'t a recognised date, version or quarter; time-based severity won\'t apply.');
  }
  if (key === 'wcagContrast' && isRecord(value) && Object.keys(value).length === 0) {
    report(context, path, 'suspicious-value',
      '`wcagContrast` is an empty map; add contrast information or remove it.');
  }
  if (context.kind === 'utilities' && key === 'platforms' && isRecord(value)) {
    for (const [platform, entry] of Object.entries(value)) {
      if (isRecord(entry) && Object.keys(entry).length === 0) {
        report(context, [...path, platform], 'suspicious-value',
          `Platform entry \`${platform}\` is empty; it says nothing about how the utility is expressed.`);
      }
    }
  }
  if (context.kind === 'utilities' && key === 'variants' && isRecord(value)) {
    for (const kind of Object.keys(value)) {
      if (kind === 'states' || kind === 'responsive' || context.variantPatterns.has(kind)) continue;
      report(context, [...path, kind], 'undeclared-variant-kind',
        `Variant kind \`${kind}\` isn't declared in \`variantPatterns\`; nothing says how its classes are named.`, true);
    }
  }
}

function warnUnknownField(
  context: WalkContext,
  key: string,
  path: Path,
  properties: Map<string, Scoped>,
): void {
  const suggestion = closestName(key, [...properties.keys()]);
  report(context, path, 'unknown-field',
    `\`${key}\` is not a known field${suggestion ? ` — did you mean \`${suggestion}\`?` : '.'}`, true);
}

/**
 * Objects whose extra keys are part of the design: utility variant kinds
 * (checked against `variantPatterns` instead) and the patterns themselves.
 */
function isOpenByDesign(kind: ManifestKind, path: Path): boolean {
  if (kind !== 'utilities') return false;
  const last = path[path.length - 1];
  return last === 'variantPatterns' || last === 'variants';
}

function report(
  context: WalkContext,
  path: Path,
  code: string,
  message: string,
  keyRange = false,
): void {
  const node = findNodeAtLocation(context.root, path);
  const target = keyRange ? node?.parent?.children?.[0] ?? node : node;
  if (!target) return;
  const range: Range = {
    start: context.document.positionAt(target.offset),
    end: context.document.positionAt(target.offset + Math.max(target.length, 1)),
  };
  context.diagnostics.push({ range, severity: DiagnosticSeverity.Warning, source: SOURCE, code, message });
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

// ─── Suggestions ───────────────────────────────────────────────────

function closestName(name: string, candidates: string[]): string | undefined {
  const limit = name.length <= 4 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    const distance = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

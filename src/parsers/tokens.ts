import type { DSToken, Status } from '../types.js';

// ─── Token data structures ─────────────────────────────────────────

/**
 * Supported token manifest structures:
 *
 * 1. LFDS format: { tokens: [ { cssVariable, resolved, group, ... } ] }
 * 2. Flat array:  [ { cssVariable, ... } ]
 * 3. Object with tokens key and arbitrary nesting
 */

interface LFDSTokenEntry {
  id?: string;
  path?: string[];
  group?: string;
  category?: string;
  type?: string;
  description?: string;
  tags?: string[];
  modes?: Record<string, string>;
  resolved?: Record<string, string>;
  aliasChain?: string;
  cssVariable?: string;
  visibility?: { isComponent?: boolean; isPrimitive?: boolean };

  // Lifecycle fields (optional)
  status?: string;
  deprecated?: boolean | string;
  deprecationMessage?: string;
  removal?: string;
  replacement?: string;
}

// ─── Parser ────────────────────────────────────────────────────────

/**
 * Parse a token manifest and return normalized DSToken[].
 * Supports multiple input formats.
 */
export function parseTokens(json: unknown, source: string): DSToken[] {
  if (!json || typeof json !== 'object') return [];

  // Try: { tokens: [...] } (LFDS format)
  if ('tokens' in (json as Record<string, unknown>)) {
    const tokens = (json as { tokens: unknown[] }).tokens;
    if (Array.isArray(tokens)) {
      return tokens
        .map((t) => parseTokenEntry(t as LFDSTokenEntry, source))
        .filter((t): t is DSToken => t !== null);
    }
  }

  // Try: plain array
  if (Array.isArray(json)) {
    return json
      .map((t) => parseTokenEntry(t as LFDSTokenEntry, source))
      .filter((t): t is DSToken => t !== null);
  }

  // Try: W3C DTCG-like nested object — walk and find $value entries
  if (typeof json === 'object') {
    const tokens: DSToken[] = [];
    walkDTCG(json as Record<string, unknown>, [], tokens, source);
    if (tokens.length > 0) return tokens;
  }

  return [];
}

function parseTokenEntry(entry: LFDSTokenEntry, source: string): DSToken | null {
  // Must have a CSS variable name
  if (!entry.cssVariable) return null;

  const deprecated = parseDeprecated(entry.deprecated);

  // Determine default resolved value
  const resolved = entry.resolved;
  let value: string | undefined;
  if (resolved) {
    // Prefer 'base', then 'light', then first available
    value = resolved.base ?? resolved.light ?? Object.values(resolved)[0];
  }

  return {
    name: entry.cssVariable,
    description: entry.description,
    group: entry.group,
    category: entry.category,
    type: entry.type,
    resolved,
    value,
    status: parseStatus(entry.status),
    deprecated: deprecated.isDeprecated,
    deprecationMessage: deprecated.message ?? entry.deprecationMessage,
    removal: entry.removal,
    replacement: entry.replacement,
    source,
  };
}

/**
 * Walk a W3C DTCG-like nested token tree.
 * Entries with $value are tokens. Groups are objects without $value.
 */
function walkDTCG(
  obj: Record<string, unknown>,
  path: string[],
  tokens: DSToken[],
  source: string,
): void {
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    if (!val || typeof val !== 'object') continue;

    const node = val as Record<string, unknown>;

    if ('$value' in node) {
      // This is a token entry
      const extensions = (node.$extensions as Record<string, unknown>) ?? {};
      const cssVariable =
        (extensions.cssVariable as string) ??
        `--${[...path, key].join('-')}`;

      const token: DSToken = {
        name: cssVariable,
        description: node.$description as string | undefined,
        group: path[0],
        category: path.length > 1 ? path.slice(1).join('/') : undefined,
        type: node.$type as string | undefined,
        value: typeof node.$value === 'string' ? node.$value : JSON.stringify(node.$value),
        status: parseStatus(node.$status as string | undefined),
        deprecated: !!node.$deprecated,
        deprecationMessage:
          typeof node.$deprecated === 'string' ? node.$deprecated : undefined,
        removal: node.$removal as string | undefined,
        replacement: node.$replacement as string | undefined,
        source,
      };
      tokens.push(token);
    } else {
      // Recurse into group
      walkDTCG(node, [...path, key], tokens, source);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function parseStatus(status: string | undefined): DSToken['status'] {
  if (!status) return undefined;
  if (['draft', 'beta', 'ready', 'deprecated'].includes(status)) {
    return status as DSToken['status'];
  }
  return undefined;
}

function parseDeprecated(
  deprecated: boolean | string | undefined,
): { isDeprecated: boolean; message?: string } {
  if (deprecated === undefined || deprecated === false) {
    return { isDeprecated: false };
  }
  if (deprecated === true) {
    return { isDeprecated: true };
  }
  return { isDeprecated: true, message: deprecated };
}

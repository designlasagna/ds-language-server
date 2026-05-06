import type { DSUtilityClass } from '../types.js';

// ─── Utility manifest structures ───────────────────────────────────

/**
 * Supported utility manifest structures:
 *
 * 1. LFDS format: { categories: [ { name, prefix, classes: [ { name, description } ] } ] }
 * 2. Flat array:  [ { name, description, category } ]
 */

interface CategorizedManifest {
  categories: UtilityCategory[];
}

interface UtilityCategory {
  name: string;
  prefix?: string;
  classes: UtilityEntry[];
}

interface UtilityEntry {
  name: string;
  description?: string;
  category?: string;
  relatedTokens?: string[];

  // Lifecycle fields (optional)
  status?: string;
  deprecated?: boolean | string;
  deprecationMessage?: string;
  removal?: string;
  replacement?: string;
}

// ─── Parser ────────────────────────────────────────────────────────

/**
 * Parse a utility class manifest and return normalized DSUtilityClass[].
 */
export function parseUtilities(json: unknown, source: string): DSUtilityClass[] {
  if (!json || typeof json !== 'object') return [];

  // Try: { categories: [...] } (LFDS format)
  if ('categories' in (json as Record<string, unknown>)) {
    const manifest = json as CategorizedManifest;
    if (Array.isArray(manifest.categories)) {
      return parseCategorized(manifest, source);
    }
  }

  // Try: plain array
  if (Array.isArray(json)) {
    return json
      .map((entry) => parseEntry(entry as UtilityEntry, undefined, source))
      .filter((u): u is DSUtilityClass => u !== null);
  }

  return [];
}

function parseCategorized(manifest: CategorizedManifest, source: string): DSUtilityClass[] {
  const utilities: DSUtilityClass[] = [];

  for (const category of manifest.categories) {
    if (!Array.isArray(category.classes)) continue;

    for (const entry of category.classes) {
      const utility = parseEntry(entry, category.name, source);
      if (utility) {
        utilities.push(utility);
      }
    }
  }

  return utilities;
}

function parseEntry(
  entry: UtilityEntry,
  categoryName: string | undefined,
  source: string,
): DSUtilityClass | null {
  if (!entry.name) return null;

  const deprecated = parseDeprecated(entry.deprecated);

  return {
    name: entry.name,
    description: entry.description,
    category: entry.category ?? categoryName,
    relatedTokens: entry.relatedTokens,
    status: parseStatus(entry.status),
    deprecated: deprecated.isDeprecated,
    deprecationMessage: deprecated.message ?? entry.deprecationMessage,
    removal: entry.removal,
    replacement: entry.replacement,
    source,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function parseStatus(status: string | undefined): DSUtilityClass['status'] {
  if (!status) return undefined;
  if (['draft', 'beta', 'ready', 'deprecated'].includes(status)) {
    return status as DSUtilityClass['status'];
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

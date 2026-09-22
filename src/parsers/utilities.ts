import type { DSUtilityClass } from '../types.js';
import { lifecycleFields, normalizeLifecycle } from '../lifecycle.js';

interface UtilityEntry { name: string; description?: string; category?: string; relatedTokens?: string[]; status?: string; deprecated?: unknown; deprecationMessage?: string; removal?: string; replacement?: string; }
interface UtilityCategory { name: string; utilities: UtilityEntry[]; }

export function parseUtilities(json: unknown, source: string, lifecycleProfile?: '0.4'): DSUtilityClass[] {
  if (!json || typeof json !== 'object') return [];
  const record = json as Record<string, unknown>;
  const v04 = record.schemaVersion === '0.4.0';
  if (Array.isArray(record.categories)) return (record.categories as UtilityCategory[]).flatMap(category =>
    Array.isArray(category.utilities) ? category.utilities.map(entry => parseEntry(entry, category.name, source, v04)).filter((entry): entry is DSUtilityClass => entry !== null) : []);
  if (Array.isArray(record.utilities)) return record.utilities.map(entry => parseEntry(entry as UtilityEntry, undefined, source, v04)).filter((entry): entry is DSUtilityClass => entry !== null);
  if (Array.isArray(json)) return json.map(entry => parseEntry(entry as UtilityEntry, undefined, source, false)).filter((entry): entry is DSUtilityClass => entry !== null);
  return [];
}

function parseEntry(entry: UtilityEntry, category: string | undefined, source: string, v04: boolean): DSUtilityClass | null {
  if (!entry.name) return null;
  const lifecycle = normalizeLifecycle(entry.deprecated, entry.status, { removal: entry.removal, replacement: entry.replacement });
  if (!v04 && lifecycle.status && !['draft', 'beta', 'ready', 'deprecated'].includes(lifecycle.status)) lifecycle.status = undefined;
  if (!lifecycle.message) lifecycle.message = entry.deprecationMessage;
  return { name: entry.name, description: entry.description, category: entry.category ?? category, relatedTokens: entry.relatedTokens,
    ...lifecycleFields(lifecycle), source };
}

import type { DSToken, LifecycleInfo, LifecycleIssue } from '../types.js';
import { lifecycleFields, normalizeLifecycle, type NormalizedLifecycle } from '../lifecycle.js';

interface TokenEntry {
  id?: string; path?: string[]; group?: string; category?: string; type?: string;
  description?: string; resolved?: Record<string, string>; cssVariable?: string;
  platforms?: { web?: { reference?: string } };
  status?: string; deprecated?: unknown; deprecationMessage?: string; removal?: string; replacement?: string;
}

/** Parses legacy manifests and explicitly selected native v0.4/DTCG sources. */
export function parseTokens(json: unknown, source: string, lifecycleProfile?: '0.4'): DSToken[] {
  if (!json || typeof json !== 'object') return [];
  const record = json as Record<string, unknown>;
  // Native manifests advertise their own contract. CEM and raw DTCG do not,
  // so they remain behind the explicit profile selection below.
  const nativeV04 = record.schemaVersion === '0.4.0';
  if (Array.isArray(record.tokens)) return record.tokens
    .map(entry => parseTokenEntry(entry as TokenEntry, source, nativeV04))
    .filter((token): token is DSToken => token !== null);
  if (Array.isArray(json)) return json.map(entry => parseTokenEntry(entry as TokenEntry, source, false))
    .filter((token): token is DSToken => token !== null);
  const tokens: DSToken[] = [];
  walkDTCG(record, record, [], tokens, source, lifecycleProfile === '0.4', undefined);
  return tokens;
}

function parseTokenEntry(entry: TokenEntry, source: string, v04: boolean): DSToken | null {
  const name = entry.platforms?.web?.reference ?? entry.cssVariable;
  if (!name) return null;
  const lifecycle = v04
    ? normalizeLifecycle(entry.deprecated, entry.status)
    : legacyLifecycle(entry.deprecated, entry.status, entry.deprecationMessage, entry.removal, entry.replacement);
  const value = entry.resolved?.base ?? entry.resolved?.light ?? (entry.resolved ? Object.values(entry.resolved)[0] : undefined);
  return { id: entry.id, name, description: entry.description, group: entry.group, category: entry.category, type: entry.type,
    resolved: entry.resolved, value, ...lifecycleFields(lifecycle), source };
}

function legacyLifecycle(deprecated: unknown, status: unknown, message?: string, removal?: string, replacement?: string): NormalizedLifecycle {
  const normalized = normalizeLifecycle(deprecated, status, { removal, replacement });
  if (message) normalized.message = message;
  // Conflict/bare assertions are v0.4 contract diagnostics, not a legacy
  // behavior change for pre-versioned native manifests.
  normalized.issues = [];
  return normalized;
}

function extension(node: Record<string, unknown>): Record<string, unknown> | undefined {
  const extensions = node.$extensions;
  if (!extensions || typeof extensions !== 'object') return undefined;
  const value = (extensions as Record<string, unknown>)['recipes.designlasagna'];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** DTCG nearest-node, whole-record inheritance. Custom status never cancels inherited lifecycle. */
function dtcgLifecycle(node: Record<string, unknown>, inherited: NormalizedLifecycle | undefined): NormalizedLifecycle | undefined {
  const ext = extension(node);
  const standard = node.$deprecated;
  const extDeprecated = ext?.deprecated;
  const status = ext?.status;
  const hasStandard = standard !== undefined;
  const hasObject = extDeprecated !== undefined;
  const normativeStatus = status === 'deprecated' || status === 'removed';
  if (!hasStandard && !hasObject && !normativeStatus) {
    if (!inherited) return normalizeLifecycle(undefined, status);
    return { ...inherited, status: typeof status === 'string' ? status : inherited.status };
  }
  const result = normalizeLifecycle(hasObject ? extDeprecated : standard, status);
  if (hasObject && typeof standard === 'string' && result.message !== standard) result.issues.push('deprecation-message-mismatch');
  if (hasObject && standard === false && !result.issues.includes('lifecycle-conflict')) result.issues.push('lifecycle-conflict');
  return result;
}

interface ExpandedNode { node: Record<string, unknown>; issues: LifecycleIssue[]; }

function targetFor(reference: string, root: Record<string, unknown>): Record<string, unknown> | undefined {
  const match = /^\{([^{}]+)\}$/.exec(reference);
  if (!match) return undefined;
  const target = match[1].split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined, root);
  return target && typeof target === 'object' && !Array.isArray(target) ? target as Record<string, unknown> : undefined;
}

/** Standard group extension: recursively expand the referenced group, then apply local overrides. */
function resolveExtends(node: Record<string, unknown>, root: Record<string, unknown>, resolving = new Set<Record<string, unknown>>()): ExpandedNode {
  if (typeof node.$extends !== 'string') return { node, issues: [] };
  const target = targetFor(node.$extends, root);
  const { $extends: _extends, ...own } = node;
  if (!target) return { node: own, issues: ['unresolved-extends'] };
  if (resolving.has(target)) return { node: own, issues: ['extends-cycle'] };
  const next = new Set(resolving).add(node).add(target);
  const expanded = resolveExtends(target, root, next);
  return { node: mergeGroups(expanded.node, own), issues: expanded.issues };
}

function mergeGroups(base: Record<string, unknown>, own: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(own)) {
    const prior = result[key];
    // Extension records and all $ properties are atomic. Ordinary nested groups
    // merge so a local group can override one inherited token/property.
    result[key] = !key.startsWith('$') && isRecord(prior) && isRecord(value)
      ? mergeGroups(prior, value)
      : value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function walkDTCG(rawNode: Record<string, unknown>, root: Record<string, unknown>, path: string[], tokens: DSToken[], source: string, v04: boolean, inherited: NormalizedLifecycle | undefined, inheritedIssues: LifecycleIssue[] = []): void {
  const expanded = v04 ? resolveExtends(rawNode, root) : { node: rawNode, issues: [] };
  const node = expanded.node;
  const issues = [...inheritedIssues, ...expanded.issues];
  const own = v04 ? dtcgLifecycle(node, inherited) : inherited;
  for (const [key, raw] of Object.entries(node)) {
    if (key.startsWith('$') || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const child = raw as Record<string, unknown>;
    if ('$value' in child) {
      const ext = extension(child);
      const lifecycle = v04 ? dtcgLifecycle(child, own) : legacyLifecycle(child.$deprecated, child.$status, undefined, child.$removal as string | undefined, child.$replacement as string | undefined);
      const name = typeof ext?.cssVariable === 'string' ? ext.cssVariable : `--${[...path, key].join('-')}`;
      const value = typeof child.$value === 'string' ? child.$value : JSON.stringify(child.$value);
      const fields = lifecycle ? lifecycleFields(lifecycle) : {} as LifecycleInfo;
      const lifecycleIssues = [...(fields.lifecycleIssues ?? []), ...issues];
      tokens.push({ name, description: child.$description as string | undefined, group: path[0], category: path.length > 1 ? path.slice(1).join('/') : undefined,
        type: child.$type as string | undefined, value, ...fields, lifecycleIssues: lifecycleIssues.length ? [...new Set(lifecycleIssues)] : undefined, source });
    } else {
      walkDTCG(child, root, [...path, key], tokens, source, v04, own, issues);
    }
  }
}

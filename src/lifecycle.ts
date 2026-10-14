import { DiagnosticSeverity } from 'vscode-languageserver';
import type { LifecycleAssertion, LifecycleInfo, LifecycleIssue, LifecycleState } from './types.js';

export interface NormalizedLifecycle {
  status?: string;
  state: LifecycleState;
  assertion: LifecycleAssertion;
  deprecated: boolean;
  message?: string;
  removal?: string;
  replacement?: string;
  issues: LifecycleIssue[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalize native/CEM-compatible lifecycle evidence without losing false vs absent. */
export function normalizeLifecycle(
  deprecated: unknown,
  status: unknown,
  siblings: { removal?: unknown; replacement?: unknown } = {},
): NormalizedLifecycle {
  const normalizedStatus = typeof status === 'string' && status ? status : undefined;
  const issues: LifecycleIssue[] = [];
  const positiveStatus = normalizedStatus === 'deprecated' || normalizedStatus === 'removed';
  const object = deprecated !== null && typeof deprecated === 'object' && !Array.isArray(deprecated)
    ? deprecated as Record<string, unknown>
    : undefined;
  const objectMessage = typeof object?.message === 'string' ? object.message : undefined;
  const stringMessage = typeof deprecated === 'string' ? deprecated : undefined;
  const positiveDeprecated = objectMessage !== undefined || typeof deprecated === 'string' || deprecated === true;
  const explicitFalse = deprecated === false;
  if (explicitFalse && (positiveStatus || positiveDeprecated)) issues.push('lifecycle-conflict');
  if (deprecated === true) issues.push('bare-deprecation');

  const state: LifecycleState = normalizedStatus === 'removed'
    ? 'removed'
    : (positiveStatus || positiveDeprecated) ? 'deprecated' : 'active';
  const message = objectMessage ?? stringMessage
    ?? (state !== 'active' ? 'Deprecated.' : undefined);
  const removal = typeof object?.removal === 'string' ? object.removal
    : typeof siblings.removal === 'string' ? siblings.removal : undefined;
  const replacement = typeof object?.replacement === 'string' ? object.replacement
    : typeof siblings.replacement === 'string' ? siblings.replacement : undefined;

  return {
    status: normalizedStatus,
    state,
    assertion: explicitFalse ? 'explicit-false' : (positiveStatus || positiveDeprecated) ? 'positive' : 'absent',
    deprecated: state !== 'active',
    message,
    removal,
    replacement,
    issues,
  };
}

export function lifecycleFields(value: NormalizedLifecycle): Pick<LifecycleInfo,
  'status' | 'deprecated' | 'deprecationMessage' | 'removal' | 'replacement' |
  'lifecycleState' | 'lifecycleAssertion' | 'lifecycleIssues'> {
  return {
    status: value.status,
    deprecated: value.deprecated,
    deprecationMessage: value.message,
    removal: value.removal,
    replacement: value.replacement,
    lifecycleState: value.state,
    lifecycleAssertion: value.assertion,
    lifecycleIssues: value.issues.length ? value.issues : undefined,
  };
}

/** Returns calendar-day distance only for a real YYYY-MM-DD UTC date. */
export function daysUntilRemoval(removal: string | undefined, now = new Date()): number | undefined {
  if (!removal || !/^\d{4}-\d{2}-\d{2}$/.test(removal)) return undefined;
  const [year, month, day] = removal.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return undefined;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((timestamp - today) / DAY_MS);
}

export function formatRemovalDate(removal: string | undefined): string | undefined {
  if (!removal) return undefined;
  const days = daysUntilRemoval(removal);
  if (days === undefined) return removal;
  if (days > 0) return `${removal} (in ${days} day${days === 1 ? '' : 's'})`;
  if (days === 0) return `${removal} (today!)`;
  const abs = Math.abs(days);
  return `${removal} (${abs} day${abs === 1 ? '' : 's'} ago)`;
}

export function getDeprecationSeverity(
  removal: string | undefined,
  override?: 'auto' | 'off' | 'information' | 'warning' | 'error',
  state?: LifecycleState,
  now?: Date,
): DiagnosticSeverity | undefined {
  if (override === 'off') return undefined;
  if (override === 'information') return DiagnosticSeverity.Information;
  if (override === 'warning') return DiagnosticSeverity.Warning;
  if (override === 'error') return DiagnosticSeverity.Error;
  if (state === 'removed') return DiagnosticSeverity.Error;
  const days = daysUntilRemoval(removal, now);
  if (days === undefined) return DiagnosticSeverity.Warning;
  if (days < 30) return DiagnosticSeverity.Error;
  if (days <= 90) return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Information;
}

export function isDeprecated(item: LifecycleInfo): boolean {
  return item.lifecycleState === 'removed' || item.lifecycleState === 'deprecated'
    || item.deprecated === true || item.status === 'deprecated' || item.status === 'removed';
}

export function buildDeprecationMessage(item: Pick<LifecycleInfo, 'deprecationMessage' | 'replacement' | 'removal'>): string {
  const parts: string[] = [];
  if (item.deprecationMessage) parts.push(item.deprecationMessage);
  if (item.replacement) parts.push(`**Replacement:** \`${item.replacement}\``);
  const removal = formatRemovalDate(item.removal);
  if (removal) parts.push(`**Removal:** ${removal}`);
  return parts.join('\n\n');
}

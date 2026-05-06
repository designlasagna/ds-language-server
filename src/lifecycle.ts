import { DiagnosticSeverity } from 'vscode-languageserver';
import type { LifecycleInfo, Status } from './types.js';

/**
 * Calculate days until a removal date.
 * Returns undefined if the removal string is not a valid ISO date.
 */
export function daysUntilRemoval(removal: string | undefined): number | undefined {
  if (!removal) return undefined;

  const date = new Date(removal);
  if (isNaN(date.getTime())) return undefined;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Format a removal date as a human-readable string.
 * e.g., "2026-07-30 (in 85 days)" or "2026-04-01 (12 days ago)"
 */
export function formatRemovalDate(removal: string | undefined): string | undefined {
  if (!removal) return undefined;

  const days = daysUntilRemoval(removal);
  if (days === undefined) return removal;

  if (days > 0) {
    return `${removal} (in ${days} day${days === 1 ? '' : 's'})`;
  } else if (days === 0) {
    return `${removal} (today!)`;
  } else {
    const abs = Math.abs(days);
    return `${removal} (${abs} day${abs === 1 ? '' : 's'} ago)`;
  }
}

/**
 * Determine diagnostic severity based on removal date.
 *
 * - >90 days away → Information
 * - 30–90 days → Warning
 * - <30 days → Error
 * - Past removal → Error
 * - No removal date → Warning
 */
export function getDeprecationSeverity(
  removal: string | undefined,
  override?: 'auto' | 'off' | 'information' | 'warning' | 'error',
): DiagnosticSeverity | undefined {
  if (override === 'off') return undefined;
  if (override === 'information') return DiagnosticSeverity.Information;
  if (override === 'warning') return DiagnosticSeverity.Warning;
  if (override === 'error') return DiagnosticSeverity.Error;

  // auto (default)
  const days = daysUntilRemoval(removal);

  if (days === undefined) {
    // No removal date or unparseable — default to warning
    return DiagnosticSeverity.Warning;
  }

  if (days <= 0) return DiagnosticSeverity.Error;
  if (days <= 30) return DiagnosticSeverity.Error;
  if (days <= 90) return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Information;
}

/**
 * Check if a lifecycle item is deprecated.
 */
export function isDeprecated(item: LifecycleInfo): boolean {
  if (typeof item.deprecated === 'boolean') return item.deprecated;
  if (item.status === 'deprecated') return true;
  return false;
}

/**
 * Get a status emoji for display.
 */
export function statusEmoji(status: Status | undefined): string {
  switch (status) {
    case 'draft': return '🧪';
    case 'beta': return '🔶';
    case 'ready': return '✅';
    case 'deprecated': return '⚠️';
    default: return '';
  }
}

/**
 * Build a deprecation message for hover/diagnostics.
 */
export function buildDeprecationMessage(item: LifecycleInfo): string {
  const parts: string[] = [];

  if (item.deprecationMessage) {
    parts.push(item.deprecationMessage);
  }

  if (item.replacement) {
    parts.push(`**Replacement:** \`${item.replacement}\``);
  }

  const removalStr = formatRemovalDate(item.removal);
  if (removalStr) {
    parts.push(`**Removal:** ${removalStr}`);
  }

  return parts.join('\n\n');
}

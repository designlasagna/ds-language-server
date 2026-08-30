import { Hover, MarkupKind } from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import { isDeprecated } from '../../lifecycle.js';
import { findPatternAroundOffset } from './shared.js';

// ─── CSS Variable Hover ────────────────────────────────────────────

export function tryVarHover(text: string, offset: number, store: DSStore): Hover | null {
  // Find var(--name) or standalone --name around the cursor
  const match = findPatternAroundOffset(text, offset, /var\(\s*(--[\w-]+)/g, 1)
    ?? findPatternAroundOffset(text, offset, /(--[\w-]+)/g, 1);

  if (!match) return null;

  const token = store.getToken(match.value);
  if (!token) return null;

  const deprecated = isDeprecated(token);

  // If deprecated, skip hover — the diagnostic already shows the warning
  if (deprecated) return null;

  const parts: string[] = [];

  parts.push(`### \`${token.name}\``);

  if (token.description) parts.push(token.description);

  // Show resolved values
  if (token.resolved && Object.keys(token.resolved).length > 1) {
    const modeValues = Object.entries(token.resolved)
      .map(([mode, val]) => `\`${val}\` (${mode})`)
      .join(' · ');
    parts.push(`**Value:** ${modeValues}`);
  } else if (token.value) {
    parts.push(`**Value:** \`${token.value}\``);
  }

  if (token.group) parts.push(`**Group:** ${token.group}`);
  if (token.category) parts.push(`**Category:** ${token.category}`);
  if (token.type) parts.push(`**Type:** ${token.type}`);
  if (token.status) parts.push(`**Status:** ${token.status}`);
  parts.push(`**Package:** ${token.source}`);

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: parts.join('\n\n'),
    },
  };
}

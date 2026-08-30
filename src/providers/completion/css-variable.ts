import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSToken } from '../../types.js';
import { isDeprecated, buildDeprecationMessage } from '../../lifecycle.js';

// ─── CSS Variable Completions ──────────────────────────────────────

export function getCssVarCompletions(prefix: string, store: DSStore): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const token of store.getTokens()) {
    if (!token.name.startsWith(prefix)) continue;

    const deprecated = isDeprecated(token);
    const valueLabel = token.value ? ` — ${token.value}` : '';
    const groupLabel = token.group ? ` · ${token.group}` : '';

    const item: CompletionItem = {
      label: token.name,
      kind: CompletionItemKind.Variable,
      detail: `${valueLabel}${groupLabel}`.trim() || undefined,
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildTokenDoc(token),
      },
      sortText: deprecated ? `~${token.name}` : `!${token.name}`,
    };

    if (deprecated) {
      item.tags = [CompletionItemTag.Deprecated];
    }

    items.push(item);
  }

  return items;
}

function buildTokenDoc(token: DSToken): string {
  const parts: string[] = [];

  if (isDeprecated(token)) {
    parts.push(`⚠️ **DEPRECATED** — \`${token.name}\`\n\n${buildDeprecationMessage(token)}\n\n---`);
  }

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

  return parts.join('\n\n');
}

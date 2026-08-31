import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSToken } from '../../types.js';
import { isDeprecated, buildDeprecationMessage } from '../../lifecycle.js';
import { formatValueList, sortCompletionItems } from './presentation.js';

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

  return sortCompletionItems(items);
}

function buildTokenDoc(token: DSToken): string {
  const parts = [`### \`${token.name}\``];

  if (token.description) parts.push(token.description);
  if (token.value) parts.push(`**Value:** \`${token.value}\``);
  if (token.type) parts.push(`**Type:** \`${token.type}\``);
  if (token.resolved && Object.keys(token.resolved).length > 1) {
    parts.push(formatValueList('Modes', Object.entries(token.resolved)
      .map(([mode, value]) => `${mode}: ${value}`)));
  }
  if (token.group) parts.push(`**Group:** ${token.group}`);
  if (token.category) parts.push(`**Category:** ${token.category}`);
  if (token.status) parts.push(`**Status:** ${token.status}`);
  if (isDeprecated(token)) parts.push(`**Deprecated**: ${buildDeprecationMessage(token)}`);
  parts.push(`**Package:** ${token.source}`);

  return parts.join('\n\n');
}

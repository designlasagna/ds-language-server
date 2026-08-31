import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSUtilityClass } from '../../types.js';
import { isDeprecated, buildDeprecationMessage } from '../../lifecycle.js';
import { sortCompletionItems } from './presentation.js';

// ─── Class Completions ─────────────────────────────────────────────

export function getClassCompletions(prefix: string, store: DSStore): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const utility of store.getUtilities()) {
    if (!utility.name.startsWith(prefix)) continue;

    const deprecated = isDeprecated(utility);

    const item: CompletionItem = {
      label: utility.name,
      kind: CompletionItemKind.Value,
      detail: utility.category ?? undefined,
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildUtilityDoc(utility),
      },
      sortText: deprecated ? `~${utility.name}` : `!${utility.name}`,
    };

    if (deprecated) {
      item.tags = [CompletionItemTag.Deprecated];
    }

    items.push(item);
  }

  return sortCompletionItems(items);
}

function buildUtilityDoc(utility: DSUtilityClass): string {
  const parts = [`### \`.${utility.name}\``];

  if (utility.description) parts.push(utility.description);
  if (utility.category) parts.push(`**Category:** ${utility.category}`);
  if (utility.relatedTokens && utility.relatedTokens.length > 0) {
    parts.push(`**Related tokens:** ${utility.relatedTokens.map((token) => `\`${token}\``).join(', ')}`);
  }
  if (isDeprecated(utility)) parts.push(`**Deprecated:** ${buildDeprecationMessage(utility)}`);
  parts.push(`**Package:** ${utility.source}`);

  return parts.join('\n\n');
}

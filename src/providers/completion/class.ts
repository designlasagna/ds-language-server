import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSUtilityClass } from '../../types.js';
import { isDeprecated, buildDeprecationMessage } from '../../lifecycle.js';

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
      documentation: utility.description
        ? {
            kind: MarkupKind.Markdown,
            value: buildUtilityDoc(utility),
          }
        : undefined,
      sortText: deprecated ? `~${utility.name}` : `!${utility.name}`,
    };

    if (deprecated) {
      item.tags = [CompletionItemTag.Deprecated];
    }

    items.push(item);
  }

  return items;
}

function buildUtilityDoc(utility: DSUtilityClass): string {
  const parts: string[] = [];

  if (isDeprecated(utility)) {
    parts.push(`**Deprecated**\n\n${buildDeprecationMessage(utility)}\n\n---`);
  }

  if (utility.description) parts.push(utility.description);
  if (utility.category) parts.push(`**Category:** ${utility.category}`);

  if (utility.relatedTokens && utility.relatedTokens.length > 0) {
    parts.push(`**Related tokens:** ${utility.relatedTokens.map((t) => `\`${t}\``).join(', ')}`);
  }

  return parts.join('\n\n');
}

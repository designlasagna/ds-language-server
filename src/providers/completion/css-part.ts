import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSCssPart } from '../../types.js';
import { isDeprecated, buildDeprecationMessage } from '../../lifecycle.js';
import { sortCompletionItems } from './presentation.js';

// ─── CSS Part Completions ──────────────────────────────────────────

export function getCssPartCompletions(
  tagName: string,
  prefix: string,
  store: DSStore,
): CompletionItem[] {
  const component = store.getComponent(tagName) ?? store.getComponentByClassName(tagName);
  if (!component) return [];

  const items: CompletionItem[] = [];

  for (const part of component.cssParts) {
    if (!part.name.startsWith(prefix)) continue;

    const deprecated = isDeprecated(part);

    const item: CompletionItem = {
      label: part.name,
      kind: CompletionItemKind.Field,
      detail: `<${tagName}> CSS part`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildCssPartDoc(part, tagName),
      },
      sortText: deprecated ? `~${part.name}` : `!${part.name}`,
    };

    if (deprecated) {
      item.tags = [CompletionItemTag.Deprecated];
    }

    items.push(item);
  }

  return sortCompletionItems(items);
}

function buildCssPartDoc(part: DSCssPart, tagName: string): string {
  const parts = [`### \`${part.name}\``];

  if (part.description) parts.push(part.description);
  parts.push(`**Component:** \`${tagName}\``);

  if (isDeprecated(part)) {
    parts.push(`**Deprecated**: ${buildDeprecationMessage(part)}`);
  }

  return parts.join('\n\n');
}

import type { DSStore } from '../../store.js';
import type { CompletionItem } from 'vscode-languageserver';
import { CompletionItemKind, CompletionItemTag, InsertTextFormat, MarkupKind } from 'vscode-languageserver';
import { buildDeprecationMessage, isDeprecated } from '../../lifecycle.js';

/**
 * Complete property or event names for a Lit component tag.
 *
 * The caller already supplies the leading `@`, so it is intentionally
 * not duplicated in the labels or insert text.
 */
export function getLitCompletions(
  tagName: string,
  prefix: string,
  kind: 'property-name' | 'event-name',
  store: DSStore,
): CompletionItem[] {
  const component = store.getComponent(tagName) ?? store.getComponentByClassName(tagName);
  if (!component) {
    return [];
  }

  const entries = (kind === 'property-name' ? component.properties : component.events) ?? [];
  const completionKind = kind === 'property-name' ? CompletionItemKind.Property : CompletionItemKind.Event;

  return entries
    .filter((entry) => entry.name.startsWith(prefix))
    .map((entry): CompletionItem => {
      const deprecated = isDeprecated(entry);

      const docParts: string[] = [];
      if (entry.description) {
        docParts.push(entry.description);
      }
      if (deprecated) {
        const deprecationMessage = buildDeprecationMessage(entry);
        if (deprecationMessage) {
          docParts.push(deprecationMessage);
        }
      }

      const item: CompletionItem = {
        label: entry.name,
        kind: completionKind,
        detail: entry.type,
        documentation: {
          value: docParts.join('\n\n'),
          kind: MarkupKind.Markdown,
        },
        insertText: entry.name + '=\\${${1}}',
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: (deprecated ? '~' : '!') + entry.name,
      };

      if (deprecated) {
        item.deprecated = true;
        item.tags = [CompletionItemTag.Deprecated];
      }

      return item;
    });
}

import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';

// ─── Attribute Value Completions ───────────────────────────────────

export function getAttributeValueCompletions(
  tagName: string,
  attrName: string,
  prefix: string,
  store: DSStore,
): CompletionItem[] {
  const component = store.getComponent(tagName) ?? store.getComponentByClassName(tagName);
  if (!component) return [];

  // Find the attribute — match by either htmlName or field name
  const attr = component.attributes.find(
    (a) => a.htmlName === attrName || a.name === attrName,
  );
  if (!attr) return [];

  const items: CompletionItem[] = [];
  const deprecatedValueMap = new Map(
    (attr.deprecatedValues ?? []).map((dv) => [dv.value, dv]),
  );

  // Active values
  const allValues = new Set([
    ...(attr.values ?? []),
    ...(attr.deprecatedValues?.map((dv) => dv.value) ?? []),
  ]);

  for (const value of allValues) {
    if (!value.startsWith(prefix)) continue;

    const deprecatedValue = deprecatedValueMap.get(value);
    const isDefault = attr.default === value;

    const item: CompletionItem = {
      label: value,
      kind: CompletionItemKind.EnumMember,
      detail: isDefault ? '(default)' : undefined,
      sortText: deprecatedValue ? `~${value}` : `!${value}`,
    };

    if (deprecatedValue) {
      item.tags = [CompletionItemTag.Deprecated];
      item.documentation = {
        kind: MarkupKind.Markdown,
        value: `⚠️ **Deprecated**\n\n${deprecatedValue.message}${
          deprecatedValue.replacement
            ? `\n\n**Replacement:** \`${deprecatedValue.replacement}\``
            : ''
        }${
          deprecatedValue.removal
            ? `\n\n**Removal:** ${deprecatedValue.removal}`
            : ''
        }`,
      };
    }

    items.push(item);
  }

  return items;
}

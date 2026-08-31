import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import { sortCompletionItems } from './presentation.js';

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
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildValueDoc(value, isDefault, deprecatedValue),
      },
      sortText: deprecatedValue ? `~${value}` : `!${value}`,
    };

    if (deprecatedValue) item.tags = [CompletionItemTag.Deprecated];

    items.push(item);
  }

  return sortCompletionItems(items);
}

function buildValueDoc(
  value: string,
  isDefault: boolean,
  deprecated: { message: string; replacement?: string; removal?: string } | undefined,
): string {
  const parts = [`### \`${value}\``];
  if (isDefault) parts.push('**Default value**');
  if (deprecated) {
    parts.push(`**Deprecated:** ${deprecated.message}`);
    if (deprecated.replacement) parts.push(`**Replacement:** \`${deprecated.replacement}\``);
    if (deprecated.removal) parts.push(`**Removal:** ${deprecated.removal}`);
  }
  return parts.join('\n\n');
}

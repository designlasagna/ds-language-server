import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSAttribute } from '../../types.js';
import { isDeprecated, buildDeprecationMessage } from '../../lifecycle.js';

// ─── Attribute Completions ─────────────────────────────────────────

export function getAttributeCompletions(
  tagName: string,
  prefix: string,
  parentTagName: string | undefined,
  store: DSStore,
): CompletionItem[] {
  const component = store.getComponent(tagName) ?? store.getComponentByClassName(tagName);
  // Even without a known component, we can still offer slot= if there's a parent
  const items: CompletionItem[] = [];

  if (component) {
    for (const attr of component.attributes) {
      if (!attr.htmlName.startsWith(prefix)) continue;

      const deprecated = isDeprecated(attr);
      const typeLabel = attr.values
        ? `"${attr.values.join('" | "')}"` : attr.type;

      const item: CompletionItem = {
        label: attr.htmlName,
        kind: CompletionItemKind.Property,
        detail: typeLabel,
        documentation: attr.description
          ? { kind: MarkupKind.Markdown, value: buildAttrDoc(attr) }
          : undefined,
        // For boolean attributes, just insert the name. For others, add ="$1"
        insertText: attr.type === 'boolean'
          ? attr.htmlName
          : `${attr.htmlName}="$1"`,
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: deprecated ? `~${attr.htmlName}` : `!${attr.htmlName}`,
      };

      if (deprecated) {
        item.tags = [CompletionItemTag.Deprecated];
      }

      items.push(item);
    }
  }

  // Offer slot="" if we're inside a parent custom element with named slots
  if ('slot'.startsWith(prefix) && parentTagName) {
    const parentComponent = store.getComponent(parentTagName) ?? store.getComponentByClassName(parentTagName);
    if (parentComponent) {
      const namedSlots = parentComponent.slots.filter(
        (s) => s.name && s.name !== 'default' && s.name !== '',
      );
      if (namedSlots.length > 0) {
        const slotNames = namedSlots.map((s) => s.name);
        items.push({
          label: 'slot',
          kind: CompletionItemKind.Property,
          detail: `"${slotNames.join('" | "')}"`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `Assign this element to a named slot in \`<${parentTagName}>\`.\n\n**Available slots:** ${slotNames.map((s) => `\`${s}\``).join(', ')}`,
          },
          insertText: `slot="$1"`,
          insertTextFormat: InsertTextFormat.Snippet,
          sortText: '!slot',
        });
      }
    }
  }

  return items;
}

function buildAttrDoc(attr: DSAttribute): string {
  const parts: string[] = [];

  if (attr.description) parts.push(attr.description);

  if (attr.type) parts.push(`**Type:** \`${attr.type}\``);
  if (attr.default !== undefined) parts.push(`**Default:** \`${attr.default}\``);

  if (attr.values && attr.values.length > 0) {
    parts.push(`**Values:** ${attr.values.map((v) => `\`${v}\``).join(', ')}`);
  }

  if (isDeprecated(attr)) {
    parts.push(`\n---\n\n**Deprecated**\n\n${buildDeprecationMessage(attr)}`);
  }

  return parts.join('\n\n');
}

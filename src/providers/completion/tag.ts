import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSAttribute } from '../../types.js';
import { isDeprecated } from '../../lifecycle.js';
import { formatValueList, sortCompletionItems } from './presentation.js';

// ─── Tag Completions ───────────────────────────────────────────────

export function getTagCompletions(prefix: string, store: DSStore): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const component of store.getComponents()) {
    // Match against both tagName (acme-button) and className (AcmeButton)
    const matchesTag = component.tagName.startsWith(prefix);
    const matchesClass = component.className?.startsWith(prefix);
    if (!matchesTag && !matchesClass) continue;

    // Use whichever name matches the prefix (prefer className for PascalCase prefix)
    const label = matchesClass ? component.className : component.tagName;
    const insertName = matchesClass ? component.className : component.tagName;

    const deprecated = isDeprecated(component);
    const statusLabel = component.status ? ` — ${component.status}` : '';

    const item: CompletionItem = {
      label,
      kind: CompletionItemKind.Class,
      detail: `Custom Element${statusLabel}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildComponentDoc(label, component.tagName, component.description, component),
      },
      insertText: buildTagSnippet({ ...component, tagName: insertName }),
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: deprecated ? `~${label}` : `!${label}`,
    };

    if (deprecated) {
      item.tags = [CompletionItemTag.Deprecated];
    }

    items.push(item);
  }

  return sortCompletionItems(items);
}

function buildTagSnippet(
  component: { tagName: string; attributes: DSAttribute[]; slots: { name: string }[] },
): string {
  const hasSlots = component.slots.some((s) => s.name === 'default' || s.name === '');
  if (hasSlots) {
    return `${component.tagName}$1>$0</${component.tagName}>`;
  }
  return `${component.tagName}$1 />`;
}

function buildComponentDoc(
  displayName: string,
  tagName: string,
  description: string,
  component: { status?: string; source: string; slots: { name: string }[]; attributes: DSAttribute[] },
): string {
  const parts: string[] = [];

  if (displayName !== tagName) {
    parts.push(`### \`${displayName}\``);
    parts.push(`**Custom element:** \`${tagName}\``);
  }

  if (description) parts.push(description);

  if (component.status) {
    parts.push(`**Status:** ${component.status}`);
  }

  parts.push(`**Package:** ${component.source}`);

  if (component.slots.length > 0) {
    parts.push(formatValueList('Slots', component.slots.map((slot) => slot.name || 'default')));
  }

  const attrNames = component.attributes
    .filter((a) => !isDeprecated(a))
    .map((a) => a.htmlName);
  if (attrNames.length > 0) {
    parts.push(formatValueList('Attributes', attrNames));
  }

  return parts.join('\n\n');
}

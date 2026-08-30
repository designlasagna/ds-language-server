import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSAttribute } from '../../types.js';
import { isDeprecated, statusEmoji } from '../../lifecycle.js';

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
    const emoji = statusEmoji(component.status);
    const statusLabel = component.status ? ` — ${component.status}` : '';

    const item: CompletionItem = {
      label,
      kind: CompletionItemKind.Class,
      detail: `${emoji} Custom Element${statusLabel}`.trim(),
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildComponentDoc(component.tagName, component.description, component),
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

  return items;
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
  tagName: string,
  description: string,
  component: { status?: string; source: string; slots: { name: string }[]; attributes: DSAttribute[] },
): string {
  const parts: string[] = [];

  if (description) parts.push(description);

  if (component.status) {
    parts.push(`**Status:** ${component.status}`);
  }

  parts.push(`**Package:** ${component.source}`);

  if (component.slots.length > 0) {
    parts.push(`**Slots:** ${component.slots.map((s) => s.name || 'default').join(', ')}`);
  }

  const attrNames = component.attributes
    .filter((a) => !isDeprecated(a))
    .map((a) => a.htmlName);
  if (attrNames.length > 0) {
    parts.push(`**Attributes:** ${attrNames.join(', ')}`);
  }

  return parts.join('\n\n');
}

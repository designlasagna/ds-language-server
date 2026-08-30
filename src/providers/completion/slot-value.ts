import {
  CompletionItem,
  CompletionItemKind,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';

// ─── Slot Value Completions ────────────────────────────────────────

export function getSlotValueCompletions(
  parentTagName: string | undefined,
  prefix: string,
  store: DSStore,
): CompletionItem[] {
  if (!parentTagName) return [];

  const component = store.getComponent(parentTagName) ?? store.getComponentByClassName(parentTagName);
  if (!component) return [];

  const items: CompletionItem[] = [];

  for (const slot of component.slots) {
    const slotName = slot.name || 'default';
    if (slotName === 'default') continue; // default slot doesn't need slot="default"
    if (!slotName.startsWith(prefix)) continue;

    items.push({
      label: slotName,
      kind: CompletionItemKind.EnumMember,
      detail: `slot — <${parentTagName}>`,
      documentation: slot.description
        ? { kind: MarkupKind.Markdown, value: slot.description }
        : undefined,
      sortText: `!${slotName}`,
    });
  }

  return items;
}

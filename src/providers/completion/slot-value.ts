import {
  CompletionItem,
  CompletionItemKind,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import { sortCompletionItems } from './presentation.js';

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
      documentation: {
        kind: MarkupKind.Markdown,
        value: [
          `### \`${slotName}\` slot`,
          ...(slot.description ? [slot.description] : []),
          `**Component:** \`<${parentTagName}>\``,
        ].join('\n\n'),
      },
      sortText: `!${slotName}`,
    });
  }

  return sortCompletionItems(items);
}

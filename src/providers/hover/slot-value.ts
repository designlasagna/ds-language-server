import { Hover, MarkupKind } from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import { findParentCustomElement } from '../../recognition.js';
import { findPatternAroundOffset } from './shared.js';

// ─── Slot Value Hover ──────────────────────────────────────────────

export function trySlotValueHover(text: string, offset: number, store: DSStore): Hover | null {
  // Match slot="value"
  const match = findPatternAroundOffset(text, offset, /slot\s*=\s*"([^"]*)"/g, 0);
  if (!match) return null;

  const fullMatch = match.value;
  const slotNameMatch = fullMatch.match(/^slot\s*=\s*"([^"]*)"$/);
  if (!slotNameMatch) return null;

  const slotName = slotNameMatch[1];
  const valueStart = match.start + fullMatch.indexOf(`"${slotName}"`) + 1;
  const valueEnd = valueStart + slotName.length;
  if (offset < valueStart || offset > valueEnd) return null;

  // Find the parent custom element
  const parentTag = findParentCustomElement(text, match.start);
  if (!parentTag) return null;

  const component = store.getComponent(parentTag);
  if (!component) return null;

  const slot = component.slots.find((s) => s.name === slotName);
  if (!slot) return null;

  const parts: string[] = [];
  parts.push(`### slot=\`"${slotName}"\` — \`<${parentTag}>\``);
  if (slot.description) parts.push(slot.description);

  const otherSlots = component.slots
    .filter((s) => s.name !== slotName && s.name !== 'default' && s.name !== '')
    .map((s) => `\`${s.name}\``);
  if (otherSlots.length > 0) {
    parts.push(`**Other slots:** ${otherSlots.join(', ')}`);
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n') },
  };
}

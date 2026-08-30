import { Hover, MarkupKind } from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import { findWordAroundOffset, findParentTag } from './shared.js';

// ─── HTML Attribute Hover ──────────────────────────────────────────

export function tryAttrHover(text: string, offset: number, store: DSStore): Hover | null {
  // Match attribute name in a tag context
  // Look for a word at the cursor position that's inside a tag
  const wordMatch = findWordAroundOffset(text, offset);
  if (!wordMatch) return null;

  const tagName = findParentTag(text, wordMatch.start);
  if (!tagName) return null;

  const component = store.getComponent(tagName);
  if (!component) return null;

  const attr = component.attributes.find(
    (a) => a.htmlName === wordMatch.value || a.name === wordMatch.value,
  );
  if (!attr) return null;

  const parts: string[] = [];

  parts.push(`### \`${attr.htmlName}\``);
  if (attr.description) parts.push(attr.description);
  parts.push(`**Type:** \`${attr.type}\``);
  if (attr.default !== undefined) parts.push(`**Default:** \`${attr.default}\``);
  if (attr.values && attr.values.length > 0) {
    parts.push(`**Values:** ${attr.values.map((v) => `\`${v}\``).join(', ')}`);
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n') },
  };
}

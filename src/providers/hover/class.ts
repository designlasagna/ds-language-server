import { Hover, MarkupKind } from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import { classValueRanges } from '../../class-values.js';
import { buildDeprecationMessage, isDeprecated } from '../../lifecycle.js';

// ─── Class Name Hover ──────────────────────────────────────────────

export function tryClassHover(text: string, offset: number, store: DSStore): Hover | null {
  // Find class="... name ..." where offset is on a class name
  const classAttrMatch = classValueRanges(text).find(({ start, end }) => offset >= start && offset <= end);
  if (!classAttrMatch) return null;

  // Find which class name the cursor is on
  const classValue = text.slice(classAttrMatch.start, classAttrMatch.end);
  const classStart = classAttrMatch.start;
  const relativeOffset = offset - classStart;

  const classes = classValue.split(/\s+/);
  let pos = 0;

  for (const className of classes) {
    if (!className) { pos++; continue; }
    const idx = classValue.indexOf(className, pos);
    if (relativeOffset >= idx && relativeOffset <= idx + className.length) {
      const utility = store.getUtility(className);
      if (!utility) return null;

      const parts: string[] = [];

      parts.push(`### \`.${utility.name}\``);
      if (utility.description) parts.push(utility.description);
      if (utility.category) parts.push(`**Category:** ${utility.category}`);
      if (isDeprecated(utility)) {
        parts.push(utility.lifecycleState === 'removed' ? '**Removed**' : '**Deprecated**');
        const message = buildDeprecationMessage(utility);
        if (message) parts.push(message);
      } else if (utility.status) {
        parts.push(`**Status:** ${utility.status}`);
      }
      parts.push(`**Package:** ${utility.source}`);

      if (utility.relatedTokens && utility.relatedTokens.length > 0) {
        parts.push(`**Related tokens:** ${utility.relatedTokens.map((t) => `\`${t}\``).join(', ')}`);
      }

      return {
        contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n') },
      };
    }
    pos = idx + className.length;
  }

  return null;
}

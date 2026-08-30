import { Hover, MarkupKind } from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import { isDeprecated, buildDeprecationHoverCallout } from '../../lifecycle.js';
import { findPatternAroundOffset } from './shared.js';

// ─── Class Name Hover ──────────────────────────────────────────────

export function tryClassHover(text: string, offset: number, store: DSStore): Hover | null {
  // Find class="... name ..." where offset is on a class name
  const classAttrMatch = findPatternAroundOffset(
    text,
    offset,
    /(?:class|className)\s*=\s*"([^"]*)"/g,
    1,
  );
  if (!classAttrMatch) return null;

  // Find which class name the cursor is on
  const classValue = classAttrMatch.value;
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

      if (isDeprecated(utility)) parts.push(`${buildDeprecationHoverCallout(utility)}\n\n---`);

      parts.push(`### \`.${utility.name}\``);
      if (utility.description) parts.push(utility.description);
      if (utility.category) parts.push(`**Category:** ${utility.category}`);
      if (utility.status) parts.push(`**Status:** ${utility.status}`);
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

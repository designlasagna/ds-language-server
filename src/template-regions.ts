import { skipExpression } from './class-values.js';
import { regexLiteralEnd } from './js-lexical.js';

/**
 * Return the static text regions of template literals whose tag (the
 * identifier directly before the opening backtick) is in `tags`.
 * Ranges contain no backticks, tag text, or ${...} characters. Line
 * comments, block comments, and quoted strings are skipped so that
 * backticks and braces inside them are never treated as templates.
 */
export function templateRanges(
  text: string,
  tags: readonly string[],
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  if (tags.length === 0) return ranges;

  const n = text.length;
  let i = 0;
  let inTemplate = false;
  let recognized = false;
  let segStart = -1;
  const flush = (end: number) => {
    if (segStart !== -1 && end > segStart) ranges.push({ start: segStart, end });
    segStart = -1;
  };

  while (i < n) {
    const ch = text[i];
    if (!inTemplate) {
      // Skip a // line comment up to (not including) the newline.
      if (ch === '/' && text[i + 1] === '/') {
        i += 2;
        while (i < n && text[i] !== '\n') i += 1;
        continue;
      }
      // Skip a /* */ block comment (also handles unterminated).
      if (ch === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
        i = Math.min(i + 2, n);
        continue;
      }
      // Skip a regex literal whose opening slash is not a comment.
      if (ch === '/' && text[i + 1] !== '/' && text[i + 1] !== '*') {
        const end = regexLiteralEnd(text, i);
        if (end !== undefined) {
          i = end;
          continue;
        }
      }
      // Skip a ' or " string literal, honoring \ escapes.
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i += 1;
        while (i < n && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
        i += 1;
        continue;
      }
      // Opening backtick: the tag is the identifier right before it.
      if (ch === '`') {
        const tag = /([\w$]+(?:\.[\w$]+)*)\s*$/.exec(text.slice(0, i))?.[1];
        recognized = tag !== undefined && tags.includes(tag);
        inTemplate = true;
        segStart = i + 1;
        i += 1;
        continue;
      }
      i += 1;
    } else if (ch === '\\') {
      // Escaped character inside the template: consume both chars.
      i += 2;
    } else if (ch === '`') {
      // Closing backtick: flush the final static segment.
      if (recognized) flush(i);
      inTemplate = false;
      recognized = false;
      i += 1;
    } else if (ch === '$' && text[i + 1] === '{') {
      // Interpolation: flush, then scan the whole ${...} expression.
      // skipExpression returns the index of the closing } (handles nesting).
      if (recognized) flush(i);
      const expressionStart = i + 2;
      const expressionEnd = skipExpression(text, expressionStart);
      // Recurse into the expression so tagged templates nested inside
      // (e.g. Lit html in ${...}) contribute their static ranges,
      // offset back into `text`. Ordinary expression text is never added.
      for (const nested of templateRanges(text.slice(expressionStart, expressionEnd), tags)) {
        ranges.push({ start: nested.start + expressionStart, end: nested.end + expressionStart });
      }
      i = expressionEnd + 1;
      segStart = i;
    } else {
      i += 1;
    }
  }

  // Unterminated template at EOF: flush the trailing static segment.
  if (inTemplate && recognized) flush(n);
  return ranges;
}

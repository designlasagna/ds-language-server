/** Static portions of class attributes, with source offsets preserved. */
export function classValueRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const opener = /\b(?:class|className|classList)\s*=\s*(?:\{\s*)?(["'`])/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text))) {
    const quote = match[1];
    let start = opener.lastIndex;
    let i = start;
    for (; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === quote) break;
      if (quote === '`' && text.slice(i, i + 2) === '${') {
        ranges.push({ start, end: i });
        i = skipExpression(text, i + 2);
        start = i + 1;
      }
    }
    if (start <= text.length) ranges.push({ start, end: Math.min(i, text.length) });
    opener.lastIndex = Math.min(i + 1, text.length);
  }
  return ranges;
}

// Skip nested braces and quoted strings; never treat interpolation contents as classes.
function skipExpression(text: string, start: number): number {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (quote === '`' && text.slice(i, i + 2) === '${') {
          i = skipExpression(text, i + 2);
        } else if (text[i] === quote) break;
      }
    } else if (text.slice(i, i + 2) === '//') {
      const end = text.indexOf('\n', i + 2);
      i = end < 0 ? text.length : end;
    } else if (text.slice(i, i + 2) === '/*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return text.length;
}

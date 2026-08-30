// ─── Helpers ───────────────────────────────────────────────────────

export interface PatternMatch {
  value: string;
  start: number;
  end: number;
}

/**
 * Find a regex pattern match around a given offset in text.
 * Returns the captured group at `groupIndex` if the offset falls within the match.
 */
export function findPatternAroundOffset(
  text: string,
  offset: number,
  pattern: RegExp,
  groupIndex: number,
): PatternMatch | null {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > offset + 200) break; // Don't scan too far
    if (offset >= match.index && offset <= match.index + match[0].length) {
      const group = match[groupIndex];
      if (group === undefined) continue;

      // Calculate group start position
      const groupStart = groupIndex === 0
        ? match.index
        : match.index + match[0].indexOf(group);

      return {
        value: group,
        start: groupStart,
        end: groupStart + group.length,
      };
    }
  }
  return null;
}

/**
 * Find the word (identifier) around a given offset.
 */
export function findWordAroundOffset(
  text: string,
  offset: number,
): PatternMatch | null {
  // Walk backward to find word start
  let start = offset;
  while (start > 0 && /[\w-]/.test(text[start - 1])) start--;

  // Walk forward to find word end
  let end = offset;
  while (end < text.length && /[\w-]/.test(text[end])) end++;

  if (start === end) return null;

  return {
    value: text.slice(start, end),
    start,
    end,
  };
}

/**
 * Find the parent tag name for a position in the text.
 * Walks backward to find the nearest `<tag-name`.
 */
export function findParentTag(text: string, offset: number): string | null {
  const before = text.slice(Math.max(0, offset - 1000), offset);
  const match = before.match(/<([\w]+-[\w-]+)(?:\s|>)[^<]*$/);
  return match ? match[1] : null;
}

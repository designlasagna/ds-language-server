import { skipExpression } from './class-values.js';
import { regexLiteralEnd } from './js-lexical.js';

/** Static classMap object keys in a recognized class-attribute interpolation. */
export function classMapRanges(
  text: string,
  attributes: readonly string[],
  recognizedText: string = text,
): { start: number; end: number }[] {
  if (!attributes.length) return [];
  const names = attributes.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const opener = new RegExp(`(?<![\\w-])(${names})\\s*=\\s*["']?\\$\\{\\s*classMap\\s*\\(\\s*\\{`, 'g');
  const ranges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(opener)) {
    if (recognizedText.slice(match.index, match.index + match[1].length) !== match[1]) continue;
    let i = match.index + match[0].length;
    while (i < text.length) {
      while (/\s|,/.test(text[i] ?? '') && i < text.length) i++;
      if (text[i] === '}' || i === text.length) break;
      if (text.startsWith('//', i) || text.startsWith('/*', i)) {
        const end = text.startsWith('//', i) ? text.indexOf('\n', i + 2) : text.indexOf('*/', i + 2);
        if (end < 0) break;
        i = end + (text.startsWith('//', i) ? 1 : 2);
        continue;
      }
      let start = i;
      let end = i;
      let literal = true;
      if (text[i] === '"' || text[i] === "'") {
        const quote = text[i++];
        start = i;
        while (i < text.length && text[i] !== quote) {
          if (text[i] === '\\') { literal = false; i++; }
          i++;
        }
        if (i >= text.length) {
          if (literal && !/\s/.test(text.slice(start))) ranges.push({ start, end: i });
          break;
        }
        end = i++;
      } else {
        const key = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
        if (!key) {
          const next = skipValue(text, i);
          if (next <= i || text[next] === '}') break;
          i = next + 1;
          continue;
        }
        i += key[0].length;
        end = i;
      }
      while (/\s/.test(text[i] ?? '') && i < text.length) i++;
      const delimiter = text[i];
      if (literal && !/\s/.test(text.slice(start, end)) &&
          (delimiter === ':' || delimiter === ',' || delimiter === '}' || i === text.length)) {
        ranges.push({ start, end });
      }
      const next = skipValue(text, delimiter === ':' ? i + 1 : i);
      if (text[next] === '}' || next >= text.length) break;
      i = next + 1;
    }
  }
  return ranges;
}

/**
 * Scan a JS object property value starting at `start` until the first
 * top-level `,` or `}` (or end of input).
 *
 * Tracks () [] {} depth via a stack. Skips single-, double- and
 * backtick-quoted strings (honoring backslash escapes; template ${...}
 * interpolations are skipped via skipExpression) and line/block comments.
 *
 * @returns index of the terminating delimiter (not consumed), or
 *          text.length when the value runs to EOF.
 */
export function skipValue(text: string, start: number): number {
  const stack: string[] = [];
  let i = start;

  while (i < text.length) {
    const ch = text.charAt(i);

    // Strings (single, double, backtick).
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < text.length && text.charAt(i) !== quote) {
        if (text.charAt(i) === '\\') {
          i += 2;
        } else if (quote === '`' && text.charAt(i) === '$' && text.charAt(i + 1) === '{') {
          i = skipExpression(text, i + 2); // expression inside ${ ... }
          if (text.charAt(i) === '}') i++; // closing brace of interpolation
        } else {
          i++;
        }
      }
      if (i < text.length) i++; // past closing quote
      continue;
    }

    // Line and block comments.
    if (ch === '/' && text.charAt(i + 1) === '/') {
      while (i < text.length && text.charAt(i) !== '\n') i++;
      continue;
    }
    if (ch === '/' && text.charAt(i + 1) === '*') {
      i += 2;
      while (i < text.length && !(text.charAt(i) === '*' && text.charAt(i + 1) === '/')) i++;
      if (i < text.length) i += 2;
      continue;
    }

    // Regex literal (slash that is not a comment): mask up to past its closing slash.
    if (ch === '/' && text.charAt(i + 1) !== '/' && text.charAt(i + 1) !== '*') {
      const end = regexLiteralEnd(text, i);
      if (end !== undefined) { i = end; continue; }
    }

    // Top-level delimiter ends the value (not consumed).
    if ((ch === ',' || ch === '}') && stack.length === 0) return i;

    // Bracket depth.
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') stack.pop();

    i++;
  }

  return i;
}

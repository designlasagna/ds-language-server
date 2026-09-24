export function selectorOwner(selector: string): string | undefined {
  const s = selector.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const m = s.match(/^([a-zA-Z][\w-]*)(\.[\w-]+|#[\w-]+|:[a-zA-Z][\w-]*)*$/);
  if (!m || !m[1].includes("-")) return undefined;
  return m[1];
}

/**
 * Find the custom-element owner of the CSS rule (if any) that is open at
 * `offset` in `text`.
 *
 * Scans `text` up to `offset`, maintaining a stack of `{` positions while
 * skipping single/double-quoted strings (with escapes) and block comments.
 * The innermost open brace's selector is then resolved with selectorOwner.
 *
 * Conservative by design: nested `&`, selector lists, and combinators all
 * fail in selectorOwner and return undefined. No inline style support yet.
 */
export function cssOwnerBefore(text: string, offset: number): string | undefined {
  const limit = Math.min(Math.max(offset, 0), text.length);
  const stack: number[] = [];
  const marks: number[] = []; // positions of {, }, ; outside strings/comments
  let quote: string | null = null;

  for (let i = 0; i < limit; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === "\\") {
        i++; // skip escaped character
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? limit - 1 : Math.min(end + 1, limit);
      continue;
    }
    if (ch === "{") {
      stack.push(i);
      marks.push(i);
    } else if (ch === "}") {
      stack.pop();
      marks.push(i);
    } else if (ch === ";") {
      marks.push(i);
    }
  }

  if (stack.length === 0) return undefined;
  const opening = stack[stack.length - 1];

  let start = 0;
  for (const p of marks) {
    if (p < opening && p + 1 > start) start = p + 1;
  }

  return selectorOwner(text.slice(start, opening));
}

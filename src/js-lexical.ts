const KEYWORDS = new Set(["return","throw","case","delete","void","typeof","yield","await","in","of","else","do"]);
const ALLOWED_PREV = "=(:,[!&|?{};~%^*+->"; // no ], ), digit, quote: those mean division

/**
 * text[start] is `/`. Returns the exclusive end of the regex literal starting there.
 * Returns undefined when the slash opens a // or /* comment or is division.
 * An unterminated regex (newline or EOF before the closing slash) is masked
 * conservatively up to that position. Never executes the regex.
 */
export function regexLiteralEnd(text: string, start: number): number | undefined {
  if (text.charAt(start) !== "/" || text.charAt(start + 1) === "/" || text.charAt(start + 1) === "*") return undefined;
  let i = start - 1;
  while (i >= 0 && /\s/.test(text.charAt(i))) i--;
  const prev = i < 0 ? "" : text.charAt(i);
  if (/^[A-Za-z_$]/.test(prev)) {
    let j = i;
    while (j >= 0 && /[A-Za-z0-9_$]/.test(text.charAt(j))) j--;
    if (!KEYWORDS.has(text.slice(j + 1, i + 1))) return undefined; // identifier (not keyword) -> division
  } else if (prev !== "" && !ALLOWED_PREV.includes(prev)) return undefined; // digit, ), ], quote, ... -> division
  let k = start + 1;
  let inClass = false;
  for (; k < text.length; k++) {
    const c = text.charAt(k);
    if (c === "\\") { k++; continue; }          // backslash escape
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) break;      // closing slash
    else if (c === "\n" || c === "\r") return k; // unfinished regex: mask up to newline
  }
  if (k >= text.length) return text.length;      // unfinished regex: mask up to EOF
  k++;                                           // past the closing slash
  while (k < text.length && /[A-Za-z]/.test(text.charAt(k))) k++; // flags
  return k;
}

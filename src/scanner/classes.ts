import type { DocumentSymbol } from './types.js';
import { classValueRanges } from '../class-values.js';

export function scanClassSymbols(
  text: string,
  knownUtilities: Set<string>,
  attributes?: readonly string[],
  ranges?: { start: number; end: number }[],
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  const seen = new Set<string>();
  for (const { start: classStart, end } of ranges ?? classValueRanges(text, attributes)) {
    const classValue = text.slice(classStart, end);

    // Split on whitespace to get individual class names
    const classNames = classValue.split(/\s+/);
    let pos = 0;

    for (const className of classNames) {
      if (!className) {
        pos++;
        continue;
      }

      const idx = classValue.indexOf(className, pos);
      if (knownUtilities.has(className)) {
        const start = classStart + idx;
        const key = `class:${start}:${start + className.length}`;
        if (!seen.has(key)) {
          seen.add(key);
          symbols.push({
            kind: 'class',
            name: className,
            start,
            end: start + className.length,
          });
        }
      }
      pos = idx + className.length;
    }
  }

  return symbols;
}

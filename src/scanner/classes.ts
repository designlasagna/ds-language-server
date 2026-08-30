import type { DocumentSymbol } from './types.js';

export function scanClassSymbols(
  text: string,
  knownUtilities: Set<string>,
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  const classRegex = /(?:class|className)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(text)) !== null) {
    const classValue = match[1];
    const classStart = match.index + match[0].indexOf(classValue);

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
        symbols.push({
          kind: 'class',
          name: className,
          start: classStart + idx,
          end: classStart + idx + className.length,
        });
      }
      pos = idx + className.length;
    }
  }

  return symbols;
}

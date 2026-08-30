import type { DocumentSymbol } from './types.js';

export function scanTagSymbols(
  text: string,
  knownTags: Set<string>,
  knownClassNames?: Set<string>,
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  // Match <tag-name where tag contains a hyphen (custom elements)
  const tagRegex = /<([\w]+-[\w-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const tagName = match[1];
    if (knownTags.has(tagName)) {
      symbols.push({
        kind: 'tag',
        name: tagName,
        start: match.index + 1, // skip <
        end: match.index + 1 + tagName.length,
      });
    }
  }

  if (knownClassNames && knownClassNames.size > 0) {
    const jsxTagRegex = /<([A-Z][\w]*)/g;
    while ((match = jsxTagRegex.exec(text)) !== null) {
      const className = match[1];
      if (knownClassNames.has(className)) {
        symbols.push({
          kind: 'tag',
          name: className,
          start: match.index + 1,
          end: match.index + 1 + className.length,
        });
      }
    }
  }

  return symbols;
}

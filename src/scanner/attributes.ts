import type { DocumentSymbol } from './types.js';

export function scanAttributeSymbols(
  text: string,
  knownTags: Set<string>,
  knownClassNames?: Set<string>,
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  const allKnownComponents = new Set([...knownTags, ...(knownClassNames ?? [])]);

  // Match <TagName or <tag-name followed by attributes up to > or />
  // Supports multiline JSX by using [\s\S] for the attribute block
  const tagBlockRegex = /<([\w]+-[\w-]+|[A-Z][\w]*)([\s\S]*?)(?:\/?>)/g;
  let match: RegExpExecArray | null;

  while ((match = tagBlockRegex.exec(text)) !== null) {
    const tagName = match[1];
    if (!allKnownComponents.has(tagName)) continue;

    const attrsStr = match[2];
    if (!attrsStr) continue;

    const attrRegex = /([\w-]+)\s*=\s*"([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;

    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      const attrName = attrMatch[1];
      const attrValue = attrMatch[2];
      // Calculate the absolute position: tag start + offset to attrsStr + attrMatch offset
      const attrsStrStart = match.index + match[0].indexOf(attrsStr);
      const attrStart = attrsStrStart + attrMatch.index;

      symbols.push({
        kind: 'attribute',
        name: attrName,
        start: attrStart,
        end: attrStart + attrMatch[0].length,
        tagName,
      });

      symbols.push({
        kind: 'attribute-value',
        name: attrValue,
        start: attrStart + attrMatch[0].indexOf(attrValue),
        end: attrStart + attrMatch[0].indexOf(attrValue) + attrValue.length,
        tagName,
        attributeName: attrName,
      });
    }
  }

  return symbols;
}

import type { DocumentSymbol } from './types.js';

export function scanCssVariableSymbols(
  text: string,
  knownTokens: Set<string>,
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  const varRegex = /var\(\s*(--[\w-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = varRegex.exec(text)) !== null) {
    const varName = match[1];
    if (knownTokens.has(varName)) {
      symbols.push({
        kind: 'css-var',
        name: varName,
        start: match.index + match[0].indexOf(varName),
        end: match.index + match[0].indexOf(varName) + varName.length,
      });
    }
  }

  return symbols;
}

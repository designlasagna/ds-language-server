import { TextDocument } from 'vscode-languageserver-textdocument';
import { scanTagSymbols } from './tags.js';
import { scanAttributeSymbols } from './attributes.js';
import { scanCssVariableSymbols } from './css-variables.js';
import { scanClassSymbols } from './classes.js';
import type { DocumentSymbol } from './types.js';

export function scanDocument(
  document: TextDocument,
  knownTags: Set<string>,
  knownTokens: Set<string>,
  knownUtilities: Set<string>,
  knownClassNames?: Set<string>,
): DocumentSymbol[] {
  const text = document.getText();

  return [
    ...scanTagSymbols(text, knownTags, knownClassNames),
    ...scanAttributeSymbols(text, knownTags, knownClassNames),
    ...scanCssVariableSymbols(text, knownTokens),
    ...scanClassSymbols(text, knownUtilities),
  ];
}

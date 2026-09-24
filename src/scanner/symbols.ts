import { TextDocument } from 'vscode-languageserver-textdocument';
import { scanTagSymbols } from './tags.js';
import { scanAttributeSymbols } from './attributes.js';
import { scanCssVariableSymbols } from './css-variables.js';
import { scanClassSymbols } from './classes.js';
import { classMapRanges } from '../class-map.js';
import { maskRecognizedText, classAttributes } from '../recognition-settings.js';
import type { DSConfig } from '../types.js';
import type { DocumentSymbol } from './types.js';

export function scanDocument(
  document: TextDocument,
  knownTags: Set<string>,
  knownTokens: Set<string>,
  knownUtilities: Set<string>,
  knownClassNames?: Set<string>,
  config?: DSConfig,
): DocumentSymbol[] {
  const text = maskRecognizedText(document.getText(), document.languageId, config);

  return [
    ...scanTagSymbols(text, knownTags, knownClassNames),
    ...scanAttributeSymbols(text, knownTags, knownClassNames),
    ...scanCssVariableSymbols(text, knownTokens),
    ...scanClassSymbols(text, knownUtilities, classAttributes(config)),
    ...scanClassSymbols(document.getText(), knownUtilities, classAttributes(config), classMapRanges(document.getText(), classAttributes(config), text)),
  ];
}

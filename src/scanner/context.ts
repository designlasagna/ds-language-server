import { TextDocument } from 'vscode-languageserver-textdocument';
import { findParentCustomElement } from '../recognition.js';
import type { CursorContext } from './types.js';

export function getCursorContext(
  document: TextDocument,
  offset: number,
): CursorContext {
  const text = document.getText();
  const before = text.slice(Math.max(0, offset - 500), offset);

  // ── CSS var() context ──────────────────────────────────────────
  // Match: var(  or  var(-  or  var(--  or  var(--prefix
  const varMatch = before.match(/var\(\s*(-{0,2}[\w-]*)$/);
  if (varMatch) {
    // Normalize prefix: always start with -- for token lookup
    let prefix = varMatch[1];
    if (prefix === '' || prefix === '-') prefix = '--';
    else if (!prefix.startsWith('--')) prefix = '--' + prefix;
    return {
      kind: 'css-var',
      prefix,
    };
  }

  // Also match standalone -- at property value position in CSS
  const cssVarMatch = before.match(/:\s*.*?(--[\w-]*)$/);
  if (cssVarMatch && !before.match(/var\(/)) {
    // Only if we're in a CSS-like context (very rough check)
    const langId = document.languageId;
    if (langId === 'css' || langId === 'scss' || langId === 'less') {
      return {
        kind: 'css-var',
        prefix: cssVarMatch[1],
      };
    }
  }

  // ── Class attribute context ────────────────────────────────────
  // Match: class="prefix  or  className="prefix
  const classMatch = before.match(
    /(?:class|className|classList)\s*=\s*["'](?:[^"']*\s)?([\w-]*)$/,
  );
  if (classMatch) {
    return {
      kind: 'class-value',
      prefix: classMatch[1],
    };
  }

  // ── HTML attribute value context ───────────────────────────────
  // Match: <tag-name ... attr="prefix
  const attrValueMatch = before.match(
    /<([\w-]+)\s+(?:[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?\s+)*([\w-]+)\s*=\s*["']([\w-]*)$/,
  );
  if (attrValueMatch) {
    const result: CursorContext = {
      kind: 'attribute-value',
      tagName: attrValueMatch[1],
      attributeName: attrValueMatch[2],
      prefix: attrValueMatch[3],
    };

    // For slot="..." we need the parent custom element
    if (attrValueMatch[2] === 'slot') {
      result.parentTagName = findParentCustomElement(text, offset);
    }

    return result;
  }

  // ── HTML attribute name context ────────────────────────────────
  // Match: <tag-name ... prefix (after tag and possibly other attrs)
  const attrNameMatch = before.match(
    /<([\w-]+)\s+(?:[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?\s+)*([\w-]*)$/,
  );
  if (attrNameMatch) {
    return {
      kind: 'attribute-name',
      tagName: attrNameMatch[1],
      prefix: attrNameMatch[2],
      parentTagName: findParentCustomElement(text, offset),
    };
  }

  // ── HTML tag context ───────────────────────────────────────────
  // Match: <prefix (not </ closing tag)
  const tagMatch = before.match(/<(?!\/)(\/?)([\w-]*)$/);
  if (tagMatch) {
    return {
      kind: 'tag-open',
      prefix: tagMatch[2],
    };
  }

  return { kind: 'none', prefix: '' };
}

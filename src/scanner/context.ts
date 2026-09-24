import { TextDocument } from 'vscode-languageserver-textdocument';
import { cssOwnerBefore, selectorOwner } from '../css-scope.js';
import { findParentCustomElement } from '../recognition.js';
import { isLanguageEnabled, maskRecognizedText, classAttributes } from '../recognition-settings.js';
import type { DSConfig } from '../types.js';
import type { CursorContext } from './types.js';
import { classValueRanges } from '../class-values.js';
import { classMapRanges } from '../class-map.js';
import { templateRanges } from '../template-regions.js';

export function getCursorContext(
  document: TextDocument,
  offset: number,
  config?: DSConfig,
): CursorContext {
  if (!isLanguageEnabled(document.languageId, config)) {
    return { kind: 'none', prefix: '' };
  }
  const text = maskRecognizedText(document.getText(), document.languageId, config);
  const before = text.slice(Math.max(0, offset - 500), offset);

  // ── classMap static key context ─────────────────────────────────
  // Keys live inside ${classMap({ ... })} interpolations, so they are
  // matched on the original text and accepted before the JS/TS static
  // template gate below.
  const keyRange = classMapRanges(document.getText(), classAttributes(config), text).find((r) => offset >= r.start && offset <= r.end);
  if (keyRange) {
    return { kind: 'class-value', prefix: document.getText().slice(keyRange.start, offset) };
  }

  // ── JS/TS static template gate ──────────────────────────────────
  // In JavaScript/TypeScript, only the static parts of recognized
  // template literals are completable; interpolation expressions are
  // not (except the classMap keys handled above).
  if (document.languageId === 'javascript' || document.languageId === 'typescript') {
    const staticRanges = templateRanges(document.getText(), [
      ...(config?.templateTags?.html ?? ['html']),
      ...(config?.templateTags?.css ?? ['css']),
    ]);
    if (!staticRanges.some((r) => r.start <= offset && offset <= r.end)) {
      return { kind: 'none', prefix: '' };
    }
  }

  // ── CSS ::part() context ───────────────────────────────────────
  // Match: ::part(  or  ::part(prefix
  const partMatch = before.match(/::part\(\s*([\w-]*)$/);
  if (partMatch) {
    // The element selector is the text before ::part since the last
    // '{', '}', or ';'. Newlines are NOT a boundary, so multi-line
    // selector lists (e.g. "ds-other,\nds-box") stay intact and are
    // rejected by selectorOwner as multiple selectors.
    const beforePart = before.slice(0, before.length - partMatch[0].length);
    const lastDelim = Math.max(
      beforePart.lastIndexOf('{'),
      beforePart.lastIndexOf('}'),
      beforePart.lastIndexOf(';'),
    );
    const selector = beforePart.slice(lastDelim + 1).trim();
    const owner = selectorOwner(selector);
    // selectorOwner only resolves a single, unambiguous custom element
    // selector; anything else (lists, combinators, classes, non-
    // custom tags) is treated as not-in-part-context.
    if (!owner) {
      return { kind: 'none', prefix: '' };
    }
    return {
      kind: 'css-part',
      tagName: owner,
      prefix: partMatch[1],
    };
  }

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
      tagName: cssOwnerBefore(text, offset),
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
        tagName: cssOwnerBefore(text, offset),
      };
    }
  }

  // ── Class attribute context ────────────────────────────────────
  const classRange = classValueRanges(text, classAttributes(config)).find(({ start, end }) => offset >= start && offset <= end);
  const classMatch = classRange
    ? text.slice(classRange.start, offset).match(/(?:^|\s)([\w-]*)$/)
    : null;
  if (classMatch) {
    return {
      kind: 'class-value',
      prefix: classMatch[1],
    };
  }

  // ── Lit .property / @event binding context ─────────────────────
  // Match: <tag-name ... .prefix  or  <tag-name ... @prefix
  // Works on the masked text, so complete ${expr} bindings are plain spaces.
  const lastLt = before.lastIndexOf('<');
  if (lastLt >= 0) {
    const openMatch = before.slice(lastLt).match(/^<([\w-]+)\s+([\s\S]*)$/);
    // Only inside a single open tag: no '>' or '<' after the tag name.
    if (openMatch && !openMatch[2].includes('>') && !openMatch[2].includes('<')) {
      // Track quote state over the remainder, honoring backslash escapes.
      let quote: '"' | "'" | null = null;
      let escaped = false;
      for (const ch of openMatch[2]) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        }
      }
      // Don't treat .name / @name inside an unterminated string as a binding.
      if (!quote) {
        const bindingMatch = openMatch[2].match(/(?:^|\s)([.@])([\w-]*)$/);
        if (bindingMatch) {
          return {
            kind: bindingMatch[1] === '.' ? 'property-name' : 'event-name',
            tagName: openMatch[1],
            prefix: bindingMatch[2],
          };
        }
      }
    }
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

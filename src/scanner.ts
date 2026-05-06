import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Represents a found design system symbol in a document.
 */
export interface DocumentSymbol {
  /** What kind of symbol */
  kind: 'tag' | 'attribute' | 'attribute-value' | 'css-var' | 'class';
  /** The matched name/value */
  name: string;
  /** Start offset in document */
  start: number;
  /** End offset in document */
  end: number;
  /** For attributes/values: the parent tag name */
  tagName?: string;
  /** For attribute-value: the attribute name */
  attributeName?: string;
}

/**
 * Context at a cursor position.
 */
export interface CursorContext {
  kind:
    | 'tag-open'          // <|  or <lfds-|
    | 'attribute-name'    // <lfds-button |
    | 'attribute-value'   // <lfds-button variant="|"
    | 'css-var'           // var(--| or var(--|lfds-
    | 'class-value'       // class="lf-|"
    | 'none';
  /** Partial text already typed */
  prefix: string;
  /** For attribute context: the tag name */
  tagName?: string;
  /** For attribute-value context: the attribute name */
  attributeName?: string;
  /** For slot context: the parent custom element tag name */
  parentTagName?: string;
}

/**
 * Determine the cursor context for completions.
 */
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

/**
 * Scan a document for all design system symbols used.
 * Used for diagnostics.
 */
export function scanDocument(
  document: TextDocument,
  knownTags: Set<string>,
  knownTokens: Set<string>,
  knownUtilities: Set<string>,
): DocumentSymbol[] {
  const text = document.getText();
  const symbols: DocumentSymbol[] = [];

  // ── Find HTML custom element tags ──────────────────────────────
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

  // ── Find attribute values on known tags ────────────────────────
  // Match <tag-name ... attr="value" patterns
  const tagBlockRegex = /<([\w]+-[\w-]+)((?:\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?)*)\s*\/?>/g;

  while ((match = tagBlockRegex.exec(text)) !== null) {
    const tagName = match[1];
    if (!knownTags.has(tagName)) continue;

    const attrsStr = match[2];
    if (!attrsStr) continue;

    const attrRegex = /([\w-]+)\s*=\s*"([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;

    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      const attrName = attrMatch[1];
      const attrValue = attrMatch[2];
      const attrStart = match.index + match[0].indexOf(attrsStr) + attrMatch.index;

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

  // ── Find CSS var() references ──────────────────────────────────
  const varRegex = /var\(\s*(--[\w-]+)/g;

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

  // ── Find class attribute values ────────────────────────────────
  const classRegex = /(?:class|className)\s*=\s*"([^"]*)"/g;

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

/**
 * Find the nearest parent custom element (tag with a hyphen) that wraps the given offset.
 * Walks backward through the text tracking open/close tags to find the enclosing element.
 */
function findParentCustomElement(text: string, offset: number): string | undefined {
  const before = text.slice(0, offset);

  // Simple approach: walk backward through tags and track nesting
  // Find all tags before our position
  const tagRegex = /<\/?([a-zA-Z][\w-]*)/g;
  const tags: { name: string; isClose: boolean; index: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = tagRegex.exec(before)) !== null) {
    const isClose = before[m.index + 1] === '/';
    const name = m[1];
    // Only care about custom elements (contain hyphen)
    if (name.includes('-')) {
      tags.push({ name, isClose, index: m.index });
    }
  }

  // Walk backward through the tags, tracking nesting
  const stack: string[] = [];
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    if (tag.isClose) {
      stack.push(tag.name);
    } else {
      if (stack.length > 0 && stack[stack.length - 1] === tag.name) {
        stack.pop(); // matched a close tag
      } else {
        // This is an unclosed open tag — it's our parent
        return tag.name;
      }
    }
  }

  return undefined;
}

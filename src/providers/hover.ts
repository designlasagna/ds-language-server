import { Hover, MarkupKind, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { DSStore } from '../store.js';
import type { DSComponent, DSAttribute } from '../types.js';
import {
  isDeprecated,
  statusEmoji,
  buildDeprecationMessage,
} from '../lifecycle.js';

/**
 * Provide hover information at a cursor position.
 */
export function getHover(
  document: TextDocument,
  position: Position,
  store: DSStore,
): Hover | null {
  const offset = document.offsetAt(position);
  const text = document.getText();

  // ── Try CSS var() hover ────────────────────────────────────────
  const varHover = tryVarHover(text, offset, store);
  if (varHover) return varHover;

  // ── Try class name hover ───────────────────────────────────────
  const classHover = tryClassHover(text, offset, store);
  if (classHover) return classHover;

  // ── Try HTML tag hover ─────────────────────────────────────────
  const tagHover = tryTagHover(text, offset, store);
  if (tagHover) return tagHover;

  // ── Try HTML attribute value hover ─────────────────────────────
  const attrValueHover = tryAttrValueHover(text, offset, store);
  if (attrValueHover) return attrValueHover;

  // ── Try HTML attribute hover ───────────────────────────────────
  const attrHover = tryAttrHover(text, offset, store);
  if (attrHover) return attrHover;

  return null;
}

// ─── CSS Variable Hover ────────────────────────────────────────────

function tryVarHover(text: string, offset: number, store: DSStore): Hover | null {
  // Find var(--name) or standalone --name around the cursor
  const match = findPatternAroundOffset(text, offset, /var\(\s*(--[\w-]+)/g, 1)
    ?? findPatternAroundOffset(text, offset, /(--[\w-]+)/g, 1);

  if (!match) return null;

  const token = store.getToken(match.value);
  if (!token) return null;

  const parts: string[] = [];
  const deprecated = isDeprecated(token);

  if (deprecated) {
    parts.push(`⚠️ **DEPRECATED** — \`${token.name}\`\n\n${buildDeprecationMessage(token)}\n\n---`);
  }

  parts.push(`### \`${token.name}\``);

  if (token.description) parts.push(token.description);

  // Show resolved values
  if (token.resolved && Object.keys(token.resolved).length > 1) {
    const modeValues = Object.entries(token.resolved)
      .map(([mode, val]) => `\`${val}\` (${mode})`)
      .join(' · ');
    parts.push(`**Value:** ${modeValues}`);
  } else if (token.value) {
    parts.push(`**Value:** \`${token.value}\``);
  }

  if (token.group) parts.push(`**Group:** ${token.group}`);
  if (token.category) parts.push(`**Category:** ${token.category}`);
  if (token.type) parts.push(`**Type:** ${token.type}`);
  if (token.status) parts.push(`**Status:** ${statusEmoji(token.status)} ${token.status}`);
  parts.push(`**Package:** ${token.source}`);

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: parts.join('\n\n'),
    },
  };
}

// ─── Class Name Hover ──────────────────────────────────────────────

function tryClassHover(text: string, offset: number, store: DSStore): Hover | null {
  // Find class="... name ..." where offset is on a class name
  const classAttrMatch = findPatternAroundOffset(
    text,
    offset,
    /(?:class|className)\s*=\s*"([^"]*)"/g,
    1,
  );
  if (!classAttrMatch) return null;

  // Find which class name the cursor is on
  const classValue = classAttrMatch.value;
  const classStart = classAttrMatch.start;
  const relativeOffset = offset - classStart;

  const classes = classValue.split(/\s+/);
  let pos = 0;

  for (const className of classes) {
    if (!className) { pos++; continue; }
    const idx = classValue.indexOf(className, pos);
    if (relativeOffset >= idx && relativeOffset <= idx + className.length) {
      const utility = store.getUtility(className);
      if (!utility) return null;

      const parts: string[] = [];
      const deprecated = isDeprecated(utility);

      if (deprecated) {
        parts.push(`⚠️ **DEPRECATED** — \`.${utility.name}\`\n\n${buildDeprecationMessage(utility)}\n\n---`);
      }

      parts.push(`### \`.${utility.name}\``);
      if (utility.description) parts.push(utility.description);
      if (utility.category) parts.push(`**Category:** ${utility.category}`);
      if (utility.status) parts.push(`**Status:** ${statusEmoji(utility.status)} ${utility.status}`);
      parts.push(`**Package:** ${utility.source}`);

      if (utility.relatedTokens && utility.relatedTokens.length > 0) {
        parts.push(`**Related tokens:** ${utility.relatedTokens.map((t) => `\`${t}\``).join(', ')}`);
      }

      return {
        contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n') },
      };
    }
    pos = idx + className.length;
  }

  return null;
}

// ─── HTML Tag Hover ────────────────────────────────────────────────

function tryTagHover(text: string, offset: number, store: DSStore): Hover | null {
  const match = findPatternAroundOffset(text, offset, /<([\w]+-[\w-]+)/g, 1);
  if (!match) return null;

  const component = store.getComponent(match.value);
  if (!component) return null;

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: buildComponentHover(component),
    },
  };
}

function buildComponentHover(component: DSComponent): string {
  const parts: string[] = [];
  const deprecated = isDeprecated(component);

  if (deprecated) {
    parts.push(`⚠️ **DEPRECATED** — \`<${component.tagName}>\`\n\n${buildDeprecationMessage(component)}\n\n---`);
  }

  parts.push(`### \`<${component.tagName}>\``);
  if (component.description) parts.push(component.description);
  if (component.status) {
    parts.push(`**Status:** ${statusEmoji(component.status)} ${component.status}`);
  }
  parts.push(`**Package:** ${component.source}`);

  if (component.slots.length > 0) {
    const slotNames = component.slots.map((s) => `\`${s.name || 'default'}\``).join(', ');
    parts.push(`**Slots:** ${slotNames}`);
  }

  const activeAttrs = component.attributes.filter((a) => !isDeprecated(a));
  if (activeAttrs.length > 0) {
    parts.push(`**Attributes:** ${activeAttrs.map((a) => `\`${a.htmlName}\``).join(', ')}`);
  }

  const deprecatedAttrs = component.attributes.filter((a) => isDeprecated(a));
  if (deprecatedAttrs.length > 0) {
    parts.push(`**Deprecated attributes:** ${deprecatedAttrs.map((a) => `~~\`${a.htmlName}\`~~`).join(', ')}`);
  }

  return parts.join('\n\n');
}

// ─── HTML Attribute Value Hover ────────────────────────────────────

function tryAttrValueHover(text: string, offset: number, store: DSStore): Hover | null {
  // Match: attr="value" and check if cursor is on the value part
  const match = findPatternAroundOffset(
    text,
    offset,
    /([\w-]+)\s*=\s*"([^"]*)"/g,
    0,
  );
  if (!match) return null;

  const fullMatch = match.value;
  const attrNameMatch = fullMatch.match(/^([\w-]+)\s*=\s*"([^"]*)"$/);
  if (!attrNameMatch) return null;

  const attrName = attrNameMatch[1];
  const attrValue = attrNameMatch[2];

  // Check if cursor is inside the value quotes
  const valueStart = match.start + fullMatch.indexOf(`"${attrValue}"`) + 1;
  const valueEnd = valueStart + attrValue.length;
  if (offset < valueStart || offset > valueEnd) return null;

  // Find the parent tag
  const tagName = findParentTag(text, match.start);
  if (!tagName) return null;

  const component = store.getComponent(tagName);
  if (!component) return null;

  const attr = component.attributes.find(
    (a) => a.htmlName === attrName || a.name === attrName,
  );
  if (!attr) return null;

  // Show attribute documentation (the diagnostic already handles deprecation warnings)
  const parts: string[] = [];
  parts.push(`### \`${attr.htmlName}="${attrValue}"\`  — \`<${tagName}>\``);
  if (attr.description) parts.push(attr.description);
  parts.push(`**Type:** \`${attr.type}\``);
  if (attr.default !== undefined) parts.push(`**Default:** \`${attr.default}\``);

  if (attr.values && attr.values.length > 0) {
    const allValues = [...(attr.values || [])];
    const deprecatedNames = new Set(attr.deprecatedValues?.map((dv) => dv.value) ?? []);
    const formatted = allValues.map((v) => {
      if (v === attrValue) return `**\`${v}\`** ← current`;
      return `\`${v}\``;
    });
    if (attr.deprecatedValues) {
      for (const dv of attr.deprecatedValues) {
        formatted.push(`~~\`${dv.value}\`~~ *(deprecated)*`);
      }
    }
    parts.push(`**Values:** ${formatted.join(', ')}`);
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n') },
  };
}

// ─── HTML Attribute Hover ──────────────────────────────────────────

function tryAttrHover(text: string, offset: number, store: DSStore): Hover | null {
  // Match attribute name in a tag context
  // Look for a word at the cursor position that's inside a tag
  const wordMatch = findWordAroundOffset(text, offset);
  if (!wordMatch) return null;

  const tagName = findParentTag(text, wordMatch.start);
  if (!tagName) return null;

  const component = store.getComponent(tagName);
  if (!component) return null;

  const attr = component.attributes.find(
    (a) => a.htmlName === wordMatch.value || a.name === wordMatch.value,
  );
  if (!attr) return null;

  const parts: string[] = [];
  const deprecated = isDeprecated(attr);

  if (deprecated) {
    parts.push(`⚠️ **DEPRECATED** — \`${attr.htmlName}\`\n\n${buildDeprecationMessage(attr)}\n\n---`);
  }

  parts.push(`### \`${attr.htmlName}\``);
  if (attr.description) parts.push(attr.description);
  parts.push(`**Type:** \`${attr.type}\``);
  if (attr.default !== undefined) parts.push(`**Default:** \`${attr.default}\``);
  if (attr.values && attr.values.length > 0) {
    parts.push(`**Values:** ${attr.values.map((v) => `\`${v}\``).join(', ')}`);
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n') },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

interface PatternMatch {
  value: string;
  start: number;
  end: number;
}

/**
 * Find a regex pattern match around a given offset in text.
 * Returns the captured group at `groupIndex` if the offset falls within the match.
 */
function findPatternAroundOffset(
  text: string,
  offset: number,
  pattern: RegExp,
  groupIndex: number,
): PatternMatch | null {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > offset + 200) break; // Don't scan too far
    if (offset >= match.index && offset <= match.index + match[0].length) {
      const group = match[groupIndex];
      if (group === undefined) continue;

      // Calculate group start position
      const groupStart = groupIndex === 0
        ? match.index
        : match.index + match[0].indexOf(group);

      return {
        value: group,
        start: groupStart,
        end: groupStart + group.length,
      };
    }
  }
  return null;
}

/**
 * Find the word (identifier) around a given offset.
 */
function findWordAroundOffset(
  text: string,
  offset: number,
): PatternMatch | null {
  // Walk backward to find word start
  let start = offset;
  while (start > 0 && /[\w-]/.test(text[start - 1])) start--;

  // Walk forward to find word end
  let end = offset;
  while (end < text.length && /[\w-]/.test(text[end])) end++;

  if (start === end) return null;

  return {
    value: text.slice(start, end),
    start,
    end,
  };
}

/**
 * Find the parent tag name for a position in the text.
 * Walks backward to find the nearest `<tag-name`.
 */
function findParentTag(text: string, offset: number): string | null {
  const before = text.slice(Math.max(0, offset - 1000), offset);
  const match = before.match(/<([\w]+-[\w-]+)(?:\s|>)[^<]*$/);
  return match ? match[1] : null;
}

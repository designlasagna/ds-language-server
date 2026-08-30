import { Hover, MarkupKind } from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import { findPatternAroundOffset, findParentTag } from './shared.js';

// ─── HTML Attribute Value Hover ────────────────────────────────────

export function tryAttrValueHover(text: string, offset: number, store: DSStore): Hover | null {
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

  // If this value is deprecated, skip hover — the diagnostic already shows the warning
  const isDeprecatedValue = attr.deprecatedValues?.some((dv) => dv.value === attrValue);
  if (isDeprecatedValue) return null;

  // Show attribute documentation for non-deprecated values
  const parts: string[] = [];
  parts.push(`### \`${attr.htmlName}="${attrValue}"\`  — \`<${tagName}>\``);
  if (attr.description) parts.push(attr.description);
  parts.push(`**Type:** \`${attr.type}\``);
  if (attr.default !== undefined) parts.push(`**Default:** \`${attr.default}\``);

  if (attr.values && attr.values.length > 0) {
    const formatted = attr.values.map((v) => {
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

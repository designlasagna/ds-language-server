import { Hover, MarkupKind } from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSComponent } from '../../types.js';
import { isDeprecated, statusEmoji, buildDeprecationMessage } from '../../lifecycle.js';
import { findPatternAroundOffset } from './shared.js';

// ─── HTML Tag Hover ────────────────────────────────────────────────

export function tryTagHover(text: string, offset: number, store: DSStore): Hover | null {
  // Match custom elements (hyphenated) or PascalCase JSX components
  const match = findPatternAroundOffset(text, offset, /<([\w]+-[\w-]+)/g, 1)
    ?? findPatternAroundOffset(text, offset, /<([A-Z][\w]*)/g, 1);
  if (!match) return null;

  // Look up by tag name first, then by class name (PascalCase React wrappers)
  const component = store.getComponent(match.value)
    ?? store.getComponentByClassName(match.value);
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

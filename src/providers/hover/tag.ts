import { Hover, MarkupKind } from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSComponent } from '../../types.js';
import { buildDeprecationMessage, isDeprecated } from '../../lifecycle.js';
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
  parts.push(`### \`<${component.tagName}>\``);
  const summary = component.description.trim().split(/\r?\n\s*\r?\n/)[0];
  if (summary) parts.push(summary);
  if (isDeprecated(component)) {
    parts.push(component.status === 'removed' ? '**Removed**' : '**Deprecated**');
    const message = buildDeprecationMessage(component);
    if (message) parts.push(message);
  } else if (component.status && !['ready', 'stable'].includes(component.status)) {
    parts.push(`**Status:** ${component.status}`);
  }

  if (component.slots.length > 0) {
    const slots = component.slots.map((s) => {
      const description = s.description?.trim();
      const notice = isDeprecated(s) ? ' **Deprecated**' : '';
      return `- \`${s.name || 'default'}\`${notice}${description ? ` — ${description}` : ''}`;
    });
    parts.push(`**Slots:**\n${slots.join('\n')}`);
  }

  return parts.join('\n\n');
}

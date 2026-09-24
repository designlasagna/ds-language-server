import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../../store.js';
import type { DSComponent, DSCssProperty, DSToken } from '../../types.js';
import { isDeprecated, buildDeprecationMessage } from '../../lifecycle.js';
import { formatValueList, sortCompletionItems } from './presentation.js';

// ─── CSS Variable Completions ──────────────────────────────────────

export function getCssVarCompletions(
  prefix: string,
  store: DSStore,
  tagName?: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const token of store.getTokens()) {
    if (!token.name.startsWith(prefix)) continue;

    const deprecated = isDeprecated(token);
    const valueLabel = token.value ? ` — ${token.value}` : '';
    const groupLabel = token.group ? ` · ${token.group}` : '';

    const item: CompletionItem = {
      label: token.name,
      kind: CompletionItemKind.Variable,
      detail: `${valueLabel}${groupLabel}`.trim() || undefined,
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildTokenDoc(token),
      },
      sortText: deprecated ? `~${token.name}` : `!${token.name}`,
    };

    if (deprecated) {
      item.tags = [CompletionItemTag.Deprecated];
    }

    items.push(item);
  }

  if (tagName) {
    const component = store.getComponent(tagName) ?? store.getComponentByClassName(tagName);
    if (component) {
      for (const prop of component.cssProperties) {
        if (!prop.name.startsWith(prefix)) continue;

        const deprecated = isDeprecated(prop);
        const syntaxLabel = prop.syntax ? ` — ${prop.syntax}` : '';
        const defaultLabel = prop.default !== undefined ? ` · ${prop.default}` : '';

        const item: CompletionItem = {
          label: prop.name,
          kind: CompletionItemKind.Variable,
          detail: `${syntaxLabel}${defaultLabel}`.trim() || undefined,
          documentation: {
            kind: MarkupKind.Markdown,
            value: buildCssPropertyDoc(prop, component),
          },
          sortText: deprecated ? `~${prop.name}` : `!${prop.name}`,
        };

        if (deprecated) {
          item.tags = [CompletionItemTag.Deprecated];
        }

        // Component-scoped properties win over global tokens with the same name
        const existing = items.findIndex((i) => i.label === prop.name);
        if (existing !== -1) {
          items[existing] = item;
        } else {
          items.push(item);
        }
      }
    }
  }

  return sortCompletionItems(items);
}

function buildTokenDoc(token: DSToken): string {
  const parts = [`### \`${token.name}\``];

  if (token.description) parts.push(token.description);
  if (token.value) parts.push(`**Value:** \`${token.value}\``);
  if (token.type) parts.push(`**Type:** \`${token.type}\``);
  if (token.resolved && Object.keys(token.resolved).length > 1) {
    parts.push(formatValueList('Modes', Object.entries(token.resolved)
      .map(([mode, value]) => `${mode}: ${value}`)));
  }
  if (token.group) parts.push(`**Group:** ${token.group}`);
  if (token.category) parts.push(`**Category:** ${token.category}`);
  if (token.status) parts.push(`**Status:** ${token.status}`);
  if (isDeprecated(token)) parts.push(`**Deprecated**: ${buildDeprecationMessage(token)}`);
  parts.push(`**Package:** ${token.source}`);

  return parts.join('\n\n');
}

function buildCssPropertyDoc(prop: DSCssProperty, component: DSComponent): string {
  const parts = [`### \`${prop.name}\``];

  if (prop.description) parts.push(prop.description);
  if (prop.syntax) parts.push(`**Syntax:** \`${prop.syntax}\``);
  if (prop.default !== undefined) parts.push(`**Default:** \`${prop.default}\``);
  parts.push(`**Component:** \`${component.tagName}\``);
  if (isDeprecated(prop)) parts.push(`**Deprecated**: ${buildDeprecationMessage(prop)}`);

  return parts.join('\n\n');
}

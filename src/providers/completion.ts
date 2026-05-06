import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver';
import type { DSStore } from '../store.js';
import type { CursorContext } from '../scanner.js';
import { isDeprecated, statusEmoji, buildDeprecationMessage } from '../lifecycle.js';
import type { DSAttribute, DSDeprecatedValue, DSToken, DSUtilityClass, Status } from '../types.js';

/**
 * Provide completion items based on cursor context.
 */
export function getCompletions(
  context: CursorContext,
  store: DSStore,
): CompletionItem[] {
  switch (context.kind) {
    case 'tag-open':
      return getTagCompletions(context.prefix, store);
    case 'attribute-name':
      return getAttributeCompletions(context.tagName!, context.prefix, context.parentTagName, store);
    case 'attribute-value':
      // Special case: slot="..." should suggest parent component's slots
      if (context.attributeName === 'slot') {
        return getSlotValueCompletions(context.parentTagName, context.prefix, store);
      }
      return getAttributeValueCompletions(
        context.tagName!,
        context.attributeName!,
        context.prefix,
        store,
      );
    case 'css-var':
      return getCssVarCompletions(context.prefix, store);
    case 'class-value':
      return getClassCompletions(context.prefix, store);
    default:
      return [];
  }
}

// ─── Tag Completions ───────────────────────────────────────────────

function getTagCompletions(prefix: string, store: DSStore): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const component of store.getComponents()) {
    if (!component.tagName.startsWith(prefix)) continue;

    const deprecated = isDeprecated(component);
    const emoji = statusEmoji(component.status);
    const statusLabel = component.status ? ` — ${component.status}` : '';

    const item: CompletionItem = {
      label: component.tagName,
      kind: CompletionItemKind.Class,
      detail: `${emoji} Custom Element${statusLabel}`.trim(),
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildComponentDoc(component.tagName, component.description, component),
      },
      insertText: buildTagSnippet(component),
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: deprecated ? `~${component.tagName}` : `!${component.tagName}`,
    };

    if (deprecated) {
      item.tags = [CompletionItemTag.Deprecated];
    }

    items.push(item);
  }

  return items;
}

function buildTagSnippet(
  component: { tagName: string; attributes: DSAttribute[]; slots: { name: string }[] },
): string {
  const hasSlots = component.slots.some((s) => s.name === 'default' || s.name === '');
  if (hasSlots) {
    return `${component.tagName}$1>$0</${component.tagName}>`;
  }
  return `${component.tagName}$1 />`;
}

function buildComponentDoc(
  tagName: string,
  description: string,
  component: { status?: string; source: string; slots: { name: string }[]; attributes: DSAttribute[] },
): string {
  const parts: string[] = [];

  if (description) parts.push(description);

  if (component.status) {
    parts.push(`**Status:** ${component.status}`);
  }

  parts.push(`**Package:** ${component.source}`);

  if (component.slots.length > 0) {
    parts.push(`**Slots:** ${component.slots.map((s) => s.name || 'default').join(', ')}`);
  }

  const attrNames = component.attributes
    .filter((a) => !isDeprecated(a))
    .map((a) => a.htmlName);
  if (attrNames.length > 0) {
    parts.push(`**Attributes:** ${attrNames.join(', ')}`);
  }

  return parts.join('\n\n');
}

// ─── Attribute Completions ─────────────────────────────────────────

function getAttributeCompletions(
  tagName: string,
  prefix: string,
  parentTagName: string | undefined,
  store: DSStore,
): CompletionItem[] {
  const component = store.getComponent(tagName);
  // Even without a known component, we can still offer slot= if there's a parent
  const items: CompletionItem[] = [];

  if (component) {
    for (const attr of component.attributes) {
      if (!attr.htmlName.startsWith(prefix)) continue;

      const deprecated = isDeprecated(attr);
      const typeLabel = attr.values
        ? `"${attr.values.join('" | "')}"` : attr.type;

      const item: CompletionItem = {
        label: attr.htmlName,
        kind: CompletionItemKind.Property,
        detail: typeLabel,
        documentation: attr.description
          ? { kind: MarkupKind.Markdown, value: buildAttrDoc(attr) }
          : undefined,
        // For boolean attributes, just insert the name. For others, add ="$1"
        insertText: attr.type === 'boolean'
          ? attr.htmlName
          : `${attr.htmlName}="$1"`,
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: deprecated ? `~${attr.htmlName}` : `!${attr.htmlName}`,
      };

      if (deprecated) {
        item.tags = [CompletionItemTag.Deprecated];
      }

      items.push(item);
    }
  }

  // Offer slot="" if we're inside a parent custom element with named slots
  if ('slot'.startsWith(prefix) && parentTagName) {
    const parentComponent = store.getComponent(parentTagName);
    if (parentComponent) {
      const namedSlots = parentComponent.slots.filter(
        (s) => s.name && s.name !== 'default' && s.name !== '',
      );
      if (namedSlots.length > 0) {
        const slotNames = namedSlots.map((s) => s.name);
        items.push({
          label: 'slot',
          kind: CompletionItemKind.Property,
          detail: `"${slotNames.join('" | "')}"`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `Assign this element to a named slot in \`<${parentTagName}>\`.\n\n**Available slots:** ${slotNames.map((s) => `\`${s}\``).join(', ')}`,
          },
          insertText: `slot="$1"`,
          insertTextFormat: InsertTextFormat.Snippet,
          sortText: '!slot',
        });
      }
    }
  }

  return items;
}

function buildAttrDoc(attr: DSAttribute): string {
  const parts: string[] = [];

  if (attr.description) parts.push(attr.description);

  if (attr.type) parts.push(`**Type:** \`${attr.type}\``);
  if (attr.default !== undefined) parts.push(`**Default:** \`${attr.default}\``);

  if (attr.values && attr.values.length > 0) {
    parts.push(`**Values:** ${attr.values.map((v) => `\`${v}\``).join(', ')}`);
  }

  if (isDeprecated(attr)) {
    parts.push(`\n---\n\n⚠️ **Deprecated**\n\n${buildDeprecationMessage(attr)}`);
  }

  return parts.join('\n\n');
}

// ─── Attribute Value Completions ───────────────────────────────────

function getAttributeValueCompletions(
  tagName: string,
  attrName: string,
  prefix: string,
  store: DSStore,
): CompletionItem[] {
  const component = store.getComponent(tagName);
  if (!component) return [];

  // Find the attribute — match by either htmlName or field name
  const attr = component.attributes.find(
    (a) => a.htmlName === attrName || a.name === attrName,
  );
  if (!attr) return [];

  const items: CompletionItem[] = [];
  const deprecatedValueMap = new Map(
    (attr.deprecatedValues ?? []).map((dv) => [dv.value, dv]),
  );

  // Active values
  const allValues = new Set([
    ...(attr.values ?? []),
    ...(attr.deprecatedValues?.map((dv) => dv.value) ?? []),
  ]);

  for (const value of allValues) {
    if (!value.startsWith(prefix)) continue;

    const deprecatedValue = deprecatedValueMap.get(value);
    const isDefault = attr.default === value;

    const item: CompletionItem = {
      label: value,
      kind: CompletionItemKind.EnumMember,
      detail: isDefault ? '(default)' : undefined,
      sortText: deprecatedValue ? `~${value}` : `!${value}`,
    };

    if (deprecatedValue) {
      item.tags = [CompletionItemTag.Deprecated];
      item.documentation = {
        kind: MarkupKind.Markdown,
        value: `⚠️ **Deprecated**\n\n${deprecatedValue.message}${
          deprecatedValue.replacement
            ? `\n\n**Replacement:** \`${deprecatedValue.replacement}\``
            : ''
        }${
          deprecatedValue.removal
            ? `\n\n**Removal:** ${deprecatedValue.removal}`
            : ''
        }`,
      };
    }

    items.push(item);
  }

  return items;
}

// ─── Slot Value Completions ────────────────────────────────────────

function getSlotValueCompletions(
  parentTagName: string | undefined,
  prefix: string,
  store: DSStore,
): CompletionItem[] {
  if (!parentTagName) return [];

  const component = store.getComponent(parentTagName);
  if (!component) return [];

  const items: CompletionItem[] = [];

  for (const slot of component.slots) {
    const slotName = slot.name || 'default';
    if (slotName === 'default') continue; // default slot doesn't need slot="default"
    if (!slotName.startsWith(prefix)) continue;

    items.push({
      label: slotName,
      kind: CompletionItemKind.EnumMember,
      detail: `slot — <${parentTagName}>`,
      documentation: slot.description
        ? { kind: MarkupKind.Markdown, value: slot.description }
        : undefined,
      sortText: `!${slotName}`,
    });
  }

  return items;
}

// ─── CSS Variable Completions ──────────────────────────────────────

function getCssVarCompletions(prefix: string, store: DSStore): CompletionItem[] {
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

  return items;
}

function buildTokenDoc(token: DSToken): string {
  const parts: string[] = [];

  if (isDeprecated(token)) {
    parts.push(`⚠️ **DEPRECATED** — \`${token.name}\`\n\n${buildDeprecationMessage(token)}\n\n---`);
  }

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
  if (token.status) parts.push(`**Status:** ${token.status}`);

  return parts.join('\n\n');
}

// ─── Class Completions ─────────────────────────────────────────────

function getClassCompletions(prefix: string, store: DSStore): CompletionItem[] {
  const items: CompletionItem[] = [];

  for (const utility of store.getUtilities()) {
    if (!utility.name.startsWith(prefix)) continue;

    const deprecated = isDeprecated(utility);

    const item: CompletionItem = {
      label: utility.name,
      kind: CompletionItemKind.Value,
      detail: utility.category ?? undefined,
      documentation: utility.description
        ? {
            kind: MarkupKind.Markdown,
            value: buildUtilityDoc(utility),
          }
        : undefined,
      sortText: deprecated ? `~${utility.name}` : `!${utility.name}`,
    };

    if (deprecated) {
      item.tags = [CompletionItemTag.Deprecated];
    }

    items.push(item);
  }

  return items;
}

function buildUtilityDoc(utility: DSUtilityClass): string {
  const parts: string[] = [];

  if (isDeprecated(utility)) {
    parts.push(`⚠️ **DEPRECATED**\n\n${buildDeprecationMessage(utility)}\n\n---`);
  }

  if (utility.description) parts.push(utility.description);
  if (utility.category) parts.push(`**Category:** ${utility.category}`);

  if (utility.relatedTokens && utility.relatedTokens.length > 0) {
    parts.push(`**Related tokens:** ${utility.relatedTokens.map((t) => `\`${t}\``).join(', ')}`);
  }

  return parts.join('\n\n');
}

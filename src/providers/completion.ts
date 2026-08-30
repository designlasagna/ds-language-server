import { CompletionItem } from 'vscode-languageserver';
import type { DSStore } from '../store.js';
import type { CursorContext } from '../scanner.js';
import { getTagCompletions } from './completion/tag.js';
import { getAttributeCompletions } from './completion/attribute.js';
import { getAttributeValueCompletions } from './completion/attribute-value.js';
import { getSlotValueCompletions } from './completion/slot-value.js';
import { getCssVarCompletions } from './completion/css-variable.js';
import { getClassCompletions } from './completion/class.js';

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

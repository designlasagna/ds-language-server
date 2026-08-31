import { CompletionItem, CompletionItemTag } from 'vscode-languageserver';

/** Keep dense lists readable without making short lists noisy. */
export function formatValueList(label: string, values: readonly string[]): string {
  const formatted = values.map((value) => `\`${value}\``);
  return formatted.length > 4
    ? `**${label}:**\n${formatted.map((value) => `- ${value}`).join('\n')}`
    : `**${label}:** ${formatted.join(', ')}`;
}

/** Active items precede deprecated items; names are ordered case-insensitively. */
export function sortCompletionItems(items: CompletionItem[]): CompletionItem[] {
  return items.sort((left, right) => {
    const leftDeprecated = left.tags?.includes(CompletionItemTag.Deprecated) ? 1 : 0;
    const rightDeprecated = right.tags?.includes(CompletionItemTag.Deprecated) ? 1 : 0;
    return leftDeprecated - rightDeprecated || left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
}

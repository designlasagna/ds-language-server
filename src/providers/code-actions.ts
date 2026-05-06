import {
  CodeAction,
  CodeActionKind,
  Diagnostic,
  TextEdit,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

interface DiagnosticData {
  type: string;
  replacement?: string;
  tagName?: string;
  attribute?: string;
  value?: string;
  token?: string;
  className?: string;
}

/**
 * Provide code actions (quick fixes) for deprecation diagnostics.
 */
export function getCodeActions(
  document: TextDocument,
  diagnostics: Diagnostic[],
): CodeAction[] {
  const actions: CodeAction[] = [];

  for (const diagnostic of diagnostics) {
    const data = diagnostic.data as DiagnosticData | undefined;
    if (!data?.replacement) continue;

    const currentText = document.getText(diagnostic.range);

    switch (data.type) {
      case 'deprecated-value': {
        // Replace attribute value: variant="tertiary" → variant="secondary"
        actions.push({
          title: `Replace "${data.value}" with "${data.replacement}"`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [document.uri]: [
                TextEdit.replace(diagnostic.range, data.replacement),
              ],
            },
          },
        });
        break;
      }

      case 'deprecated-token': {
        // Replace token: --old-token → --new-token
        actions.push({
          title: `Replace with \`${data.replacement}\``,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [document.uri]: [
                TextEdit.replace(diagnostic.range, data.replacement),
              ],
            },
          },
        });
        break;
      }

      case 'deprecated-utility': {
        // Replace class name: old-class → new-class
        actions.push({
          title: `Replace "${data.className}" with "${data.replacement}"`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [document.uri]: [
                TextEdit.replace(diagnostic.range, data.replacement),
              ],
            },
          },
        });
        break;
      }

      case 'deprecated-attribute': {
        // Suggest replacement attribute if available
        actions.push({
          title: `Replace "${data.attribute}" with "${data.replacement}"`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [document.uri]: [
                TextEdit.replace(diagnostic.range, currentText.replace(data.attribute!, data.replacement)),
              ],
            },
          },
        });
        break;
      }
    }
  }

  return actions;
}

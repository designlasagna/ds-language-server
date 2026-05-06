import {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { DSStore } from '../store.js';
import type { DSConfig } from '../types.js';
import { scanDocument } from '../scanner.js';
import {
  isDeprecated,
  getDeprecationSeverity,
  formatRemovalDate,
  daysUntilRemoval,
} from '../lifecycle.js';

const SOURCE = 'ds-language-server';

/**
 * Analyze a document and return deprecation/lifecycle diagnostics.
 */
export function getDiagnostics(
  document: TextDocument,
  store: DSStore,
  config?: DSConfig,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Build sets for the scanner
  const knownTags = new Set(store.getComponents().map((c) => c.tagName));
  const knownTokens = new Set(store.getTokens().map((t) => t.name));
  const knownUtilities = new Set(store.getUtilities().map((u) => u.name));

  const symbols = scanDocument(document, knownTags, knownTokens, knownUtilities);
  const severityOverride = config?.diagnostics?.deprecated;

  for (const symbol of symbols) {
    switch (symbol.kind) {
      case 'tag': {
        const component = store.getComponent(symbol.name);
        if (!component) break;

        // Deprecated component
        if (isDeprecated(component)) {
          const severity = getDeprecationSeverity(component.removal, severityOverride);
          if (severity === undefined) break;

          diagnostics.push({
            range: {
              start: document.positionAt(symbol.start),
              end: document.positionAt(symbol.end),
            },
            severity,
            source: SOURCE,
            message: buildDeprecationDiagnostic(
              `<${component.tagName}>`,
              component.deprecationMessage,
              component.removal,
              component.replacement,
            ),
            tags: [DiagnosticTag.Deprecated],
            data: {
              type: 'deprecated-component',
              tagName: component.tagName,
              replacement: component.replacement,
            },
          });
        }

        // Draft component
        if (component.status === 'draft') {
          const draftSeverity = config?.diagnostics?.draftUsage;
          if (draftSeverity !== 'off') {
            diagnostics.push({
              range: {
                start: document.positionAt(symbol.start),
                end: document.positionAt(symbol.end),
              },
              severity: draftSeverity === 'warning'
                ? DiagnosticSeverity.Warning
                : DiagnosticSeverity.Information,
              source: SOURCE,
              message: `\`<${component.tagName}>\` is in draft status. API may change.`,
            });
          }
        }
        break;
      }

      case 'attribute': {
        if (!symbol.tagName) break;
        const component = store.getComponent(symbol.tagName);
        if (!component) break;

        const attr = component.attributes.find(
          (a) => a.htmlName === symbol.name || a.name === symbol.name,
        );
        if (!attr || !isDeprecated(attr)) break;

        const severity = getDeprecationSeverity(attr.removal, severityOverride);
        if (severity === undefined) break;

        diagnostics.push({
          range: {
            start: document.positionAt(symbol.start),
            end: document.positionAt(symbol.end),
          },
          severity,
          source: SOURCE,
          message: buildDeprecationDiagnostic(
            `${symbol.name}`,
            attr.deprecationMessage,
            attr.removal,
            attr.replacement,
          ),
          tags: [DiagnosticTag.Deprecated],
          data: {
            type: 'deprecated-attribute',
            tagName: symbol.tagName,
            attribute: symbol.name,
            replacement: attr.replacement,
          },
        });
        break;
      }

      case 'attribute-value': {
        if (!symbol.tagName || !symbol.attributeName) break;
        const component = store.getComponent(symbol.tagName);
        if (!component) break;

        const attr = component.attributes.find(
          (a) => a.htmlName === symbol.attributeName || a.name === symbol.attributeName,
        );
        if (!attr?.deprecatedValues) break;

        const deprecatedValue = attr.deprecatedValues.find(
          (dv) => dv.value === symbol.name,
        );
        if (!deprecatedValue) break;

        const severity = getDeprecationSeverity(deprecatedValue.removal, severityOverride);
        if (severity === undefined) break;

        diagnostics.push({
          range: {
            start: document.positionAt(symbol.start),
            end: document.positionAt(symbol.end),
          },
          severity,
          source: SOURCE,
          message: buildDeprecationDiagnostic(
            `${symbol.attributeName}="${symbol.name}"`,
            deprecatedValue.message,
            deprecatedValue.removal,
            deprecatedValue.replacement,
          ),
          tags: [DiagnosticTag.Deprecated],
          data: {
            type: 'deprecated-value',
            tagName: symbol.tagName,
            attribute: symbol.attributeName,
            value: symbol.name,
            replacement: deprecatedValue.replacement,
          },
        });
        break;
      }

      case 'css-var': {
        const token = store.getToken(symbol.name);
        if (!token || !isDeprecated(token)) break;

        const severity = getDeprecationSeverity(token.removal, severityOverride);
        if (severity === undefined) break;

        diagnostics.push({
          range: {
            start: document.positionAt(symbol.start),
            end: document.positionAt(symbol.end),
          },
          severity,
          source: SOURCE,
          message: buildDeprecationDiagnostic(
            `\`${token.name}\``,
            token.deprecationMessage,
            token.removal,
            token.replacement,
          ),
          tags: [DiagnosticTag.Deprecated],
          data: {
            type: 'deprecated-token',
            token: token.name,
            replacement: token.replacement,
          },
        });
        break;
      }

      case 'class': {
        const utility = store.getUtility(symbol.name);
        if (!utility || !isDeprecated(utility)) break;

        const severity = getDeprecationSeverity(utility.removal, severityOverride);
        if (severity === undefined) break;

        diagnostics.push({
          range: {
            start: document.positionAt(symbol.start),
            end: document.positionAt(symbol.end),
          },
          severity,
          source: SOURCE,
          message: buildDeprecationDiagnostic(
            `.${utility.name}`,
            utility.deprecationMessage,
            utility.removal,
            utility.replacement,
          ),
          tags: [DiagnosticTag.Deprecated],
          data: {
            type: 'deprecated-utility',
            className: utility.name,
            replacement: utility.replacement,
          },
        });
        break;
      }
    }
  }

  return diagnostics;
}

// ─── Helpers ───────────────────────────────────────────────────────

function buildDeprecationDiagnostic(
  name: string,
  message: string | undefined,
  removal: string | undefined,
  replacement: string | undefined,
): string {
  const parts: string[] = [];
  const days = daysUntilRemoval(removal);

  if (days !== undefined && days <= 0) {
    parts.push(`${name} was scheduled for removal on ${removal}.`);
  } else if (days !== undefined && days <= 30) {
    parts.push(`${name} will be removed on ${removal} (in ${days} days!).`);
  } else {
    parts.push(`${name} is deprecated.`);
  }

  if (message) parts.push(message);

  if (replacement) {
    parts.push(`Replace with \`${replacement}\`.`);
  }

  if (removal && days !== undefined && days > 30) {
    parts.push(`Removal: ${formatRemovalDate(removal)}.`);
  }

  return parts.join(' ');
}

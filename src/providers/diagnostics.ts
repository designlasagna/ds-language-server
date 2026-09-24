import {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { DSStore } from '../store.js';
import type { DSConfig, LifecycleInfo, LifecycleIssue } from '../types.js';
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
  // Also include PascalCase class names for JSX/TSX
  const knownClassNames = new Set(store.getComponents().filter((c) => c.className).map((c) => c.className));
  const knownTokens = new Set(store.getTokens().map((t) => t.name));
  const knownUtilities = new Set(store.getUtilities().map((u) => u.name));

  const symbols = scanDocument(document, knownTags, knownTokens, knownUtilities, knownClassNames, config);

  for (const symbol of symbols) {
    switch (symbol.kind) {
      case 'tag': {
        const component = store.getComponent(symbol.name) ?? store.getComponentByClassName(symbol.name);
        if (!component) break;

        addLifecycleDiagnostics(diagnostics, document, symbol.start, symbol.end, component);
        // Deprecated component
        if (isDeprecated(component)) {
          const severity = getDeprecationSeverity(component.removal, deprecatedSeverityForSource(config, component.source), component.lifecycleState);
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
              // Component tags are deliberately diagnostic-only: paired-tag edits are unsafe.
              replacement: undefined,
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
        const component = store.getComponent(symbol.tagName) ?? store.getComponentByClassName(symbol.tagName);
        if (!component) break;

        const attr = component.attributes.find(
          (a) => a.htmlName === symbol.name || a.name === symbol.name,
        );
        if (!attr) break;
        addLifecycleDiagnostics(diagnostics, document, symbol.start, symbol.end, attr,
          replacementIssue(component.attributes.filter(attribute => attribute.htmlName === attr.replacement || attribute.name === attr.replacement), attr.replacement, attr.htmlName));
        if (!isDeprecated(attr)) break;

        const severity = getDeprecationSeverity(attr.removal, deprecatedSeverityForSource(config, component.source), attr.lifecycleState);
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
            replacement: safeAttributeReplacement(component, attr.htmlName, attr.replacement),
          },
        });
        break;
      }

      case 'attribute-value': {
        if (!symbol.tagName || !symbol.attributeName) break;
        const component = store.getComponent(symbol.tagName) ?? store.getComponentByClassName(symbol.tagName);
        if (!component) break;

        const attr = component.attributes.find(
          (a) => a.htmlName === symbol.attributeName || a.name === symbol.attributeName,
        );
        if (!attr?.deprecatedValues) break;

        const deprecatedValue = attr.deprecatedValues.find(
          (dv) => dv.value === symbol.name,
        );
        if (!deprecatedValue) break;

        const severity = getDeprecationSeverity(deprecatedValue.removal, deprecatedSeverityForSource(config, component.source));
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
            replacement: safeValueReplacement(attr, deprecatedValue.replacement),
          },
        });
        break;
      }

      case 'css-var': {
        const token = store.getToken(symbol.name);
        if (!token) break;
        const tokenReplacement = tokenReplacementResult(store, token.name, token.source, token.replacement);
        addLifecycleDiagnostics(diagnostics, document, symbol.start, symbol.end, token, tokenReplacement.issue);
        if (!isDeprecated(token)) break;

        const severity = getDeprecationSeverity(token.removal, deprecatedSeverityForSource(config, token.source), token.lifecycleState);
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
            replacement: tokenReplacement.replacement,
          },
        });
        break;
      }

      case 'class': {
        const utility = store.getUtility(symbol.name);
        if (!utility) break;
        const utilityReplacement = utilityReplacementResult(store, utility.name, utility.source, utility.replacement);
        addLifecycleDiagnostics(diagnostics, document, symbol.start, symbol.end, utility, utilityReplacement.issue);
        if (!isDeprecated(utility)) break;

        const severity = getDeprecationSeverity(utility.removal, deprecatedSeverityForSource(config, utility.source), utility.lifecycleState);
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
            replacement: utilityReplacement.replacement,
          },
        });
        break;
      }
    }
  }

  return diagnostics;
}

// ─── Helpers ───────────────────────────────────────────────────────

const DEPRECATION_SEVERITY_MODES = new Set(['auto', 'off', 'information', 'warning', 'error']);

function isDeprecationSeverityMode(value: unknown): value is 'auto' | 'off' | 'information' | 'warning' | 'error' {
  return typeof value === 'string' && DEPRECATION_SEVERITY_MODES.has(value);
}

/**
 * Deprecated severity for one package source: the per-package setting
 * (`diagnostics.packages[<source>].deprecated`) takes precedence over the
 * global setting; unsupported runtime values fall back.
 */
function deprecatedSeverityForSource(
  config: DSConfig | undefined,
  source: string,
): 'auto' | 'off' | 'information' | 'warning' | 'error' | undefined {
  const mode = (value: unknown) => (isDeprecationSeverityMode(value) ? value : undefined);
  return mode(config?.diagnostics?.packages?.[source]?.deprecated)
    ?? mode(config?.diagnostics?.deprecated);
}

interface ReplacementResult { replacement?: string; issue?: LifecycleIssue; }

function tokenReplacementResult(store: DSStore, current: string, source: string, replacement: string | undefined): ReplacementResult {
  if (!replacement || replacement === current) return {};
  const matches = store.getTokens().filter(token => token.source === source && (token.id === replacement || token.name === replacement));
  const issue = replacementIssue(matches, replacement, current);
  if (issue || matches[0].lifecycleState === 'removed' || tokenReplacementCycles(store, source, current, matches[0])) return { issue };
  return { replacement: matches[0].name };
}

function tokenReplacementCycles(store: DSStore, source: string, current: string, target: { id?: string; name: string; replacement?: string }): boolean {
  const seen = new Set([current]);
  let item: { id?: string; name: string; replacement?: string } | undefined = target;
  while (item) {
    if (seen.has(item.name) || (item.id !== undefined && seen.has(item.id))) return true;
    seen.add(item.name);
    if (item.id) seen.add(item.id);
    if (!item.replacement) return false;
    const matches = store.getTokens().filter(token => token.source === source && (token.id === item!.replacement || token.name === item!.replacement));
    if (matches.length !== 1) return false;
    item = matches[0];
  }
  return false;
}

function utilityReplacementResult(store: DSStore, current: string, source: string, replacement: string | undefined): ReplacementResult {
  if (!replacement || replacement === current) return {};
  const matches = store.getUtilities().filter(utility => utility.source === source && utility.name === replacement);
  const issue = replacementIssue(matches, replacement, current);
  return issue || matches[0].lifecycleState === 'removed' ? { issue } : { replacement };
}

function replacementIssue(matches: readonly { lifecycleState?: string }[], replacement: string | undefined, current: string): LifecycleIssue | undefined {
  if (!replacement || replacement === current) return undefined;
  if (matches.length === 0 || (matches.length === 1 && matches[0].lifecycleState === 'removed')) return 'unresolved-replacement';
  return matches.length > 1 ? 'ambiguous-replacement' : undefined;
}

function addLifecycleDiagnostics(diagnostics: Diagnostic[], document: TextDocument, start: number, end: number, item: LifecycleInfo, extra?: LifecycleIssue): void {
  const issues = [...new Set([...(item.lifecycleIssues ?? []), ...(extra ? [extra] : [])])];
  for (const issue of issues) {
    diagnostics.push({
      range: { start: document.positionAt(start), end: document.positionAt(end) },
      severity: DiagnosticSeverity.Warning,
      source: SOURCE,
      message: lifecycleIssueMessage(issue),
      data: { type: issue },
    });
  }
}

function lifecycleIssueMessage(issue: LifecycleIssue): string {
  const messages: Record<LifecycleIssue, string> = {
    'lifecycle-conflict': 'Conflicting lifecycle assertions; the positive lifecycle state is used.',
    'bare-deprecation': 'Bare deprecation has no authored migration message.',
    'deprecation-message-mismatch': 'Standard and extension deprecation messages disagree; the extension message is used.',
    'unresolved-replacement': 'The declared lifecycle replacement cannot be resolved safely; no action is available.',
    'ambiguous-replacement': 'The declared lifecycle replacement is ambiguous; no action is available.',
    'unresolved-extends': 'The DTCG $extends target could not be resolved.',
    'extends-cycle': 'The DTCG $extends chain contains a cycle.',
  };
  return messages[issue];
}

function safeAttributeReplacement(component: ReturnType<DSStore['getComponent']>, current: string, replacement: string | undefined): string | undefined {
  if (!component || !replacement || replacement === current) return undefined;
  const matches = component.attributes.filter(attribute => attribute.htmlName === replacement || attribute.name === replacement);
  return matches.length === 1 && matches[0].lifecycleState !== 'removed' ? replacement : undefined;
}

function safeValueReplacement(attribute: { values?: string[] }, replacement: string | undefined): string | undefined {
  return replacement && attribute.values?.includes(replacement) ? replacement : undefined;
}

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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Diagnostic } from 'vscode-languageserver';
import type { DSConfig } from '../src/types.js';
import { DSStore } from '../src/store.js';
import { getDiagnostics } from '../src/providers/diagnostics.js';

// Far-future removal so the 'auto' computation resolves to Information.
const REMOVAL = '2099-01-01';

let root: string;
let store: DSStore;
const htmlDoc = TextDocument.create('file:///page.html', 'html', 1,
  '<x-alpha old-attr="1" variant="old"></x-alpha><x-beta></x-beta><div class="a-util"></div><div class="b-util"></div>');
const cssDoc = TextDocument.create('file:///page.css', 'css', 1,
  'a { color: var(--a-token); gap: var(--b-token); }');

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsls-package-severity-'));

  const cemA = join(root, 'a.custom-elements.json');
  writeFileSync(cemA, JSON.stringify({
    modules: [{ declarations: [{
      name: 'Alpha',
      tagName: 'x-alpha',
      deprecated: { message: 'Use x-alpha-2 instead.', replacement: 'x-alpha-2' },
      removal: REMOVAL,
      attributes: [
        // Bare deprecation: also emits a lifecycle-issue diagnostic.
        { name: 'old-attr', type: 'string', deprecated: true, removal: REMOVAL },
        {
          name: 'variant',
          type: 'string',
          deprecatedValues: [{ value: 'old', message: 'Use new instead.', removal: REMOVAL, replacement: 'new' }],
        },
      ],
    }] }],
  }));
  const cemB = join(root, 'b.custom-elements.json');
  writeFileSync(cemB, JSON.stringify({
    modules: [{ declarations: [{ name: 'Beta', tagName: 'x-beta', status: 'removed' }] }],
  }));
  const tokensA = join(root, 'a.tokens.json');
  writeFileSync(tokensA, JSON.stringify({
    tokens: [{ platforms: { web: { reference: '--a-token' } }, deprecated: 'Use --a-token-2 instead.', removal: REMOVAL }],
  }));
  const tokensB = join(root, 'b.tokens.json');
  writeFileSync(tokensB, JSON.stringify({
    tokens: [{ platforms: { web: { reference: '--b-token' } }, deprecated: 'Use --b-token-2 instead.', removal: REMOVAL }],
  }));
  const utilitiesA = join(root, 'a.utilities.json');
  writeFileSync(utilitiesA, JSON.stringify({
    utilities: [{ name: 'a-util', deprecated: 'Use .a-util-2 instead.', removal: REMOVAL }],
  }));
  const utilitiesB = join(root, 'b.utilities.json');
  writeFileSync(utilitiesB, JSON.stringify({
    utilities: [{ name: 'b-util', deprecated: 'Use .b-util-2 instead.', removal: REMOVAL }],
  }));

  store = new DSStore();
  store.load({
    components: [
      { path: cemA, packageName: 'pkg-a' },
      { path: cemB, packageName: 'pkg-b' },
    ],
    tokens: [
      { path: tokensA, packageName: 'pkg-a' },
      { path: tokensB, packageName: 'pkg-b' },
    ],
    utilities: [
      { path: utilitiesA, packageName: 'pkg-a' },
      { path: utilitiesB, packageName: 'pkg-b' },
    ],
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function diagnosticType(item: Diagnostic): string | undefined {
  return (item.data as { type?: string } | undefined)?.type;
}

function diagnostics(document: TextDocument, config: DSConfig | undefined): Diagnostic[] {
  return getDiagnostics(document, store, config);
}

function findDeprecation(document: TextDocument, config: DSConfig | undefined, type: string): Diagnostic | undefined {
  return diagnostics(document, config).find(item => diagnosticType(item) === type);
}

function findComponent(config: DSConfig | undefined, tagName: string): Diagnostic | undefined {
  return diagnostics(htmlDoc, config).find(
    item => diagnosticType(item) === 'deprecated-component' && (item.data as { tagName?: string }).tagName === tagName,
  );
}

function findToken(config: DSConfig | undefined, token: string): Diagnostic | undefined {
  return diagnostics(cssDoc, config).find(
    item => diagnosticType(item) === 'deprecated-token' && (item.data as { token?: string }).token === token,
  );
}

function findUtility(config: DSConfig | undefined, className: string): Diagnostic | undefined {
  return diagnostics(htmlDoc, config).find(
    item => diagnosticType(item) === 'deprecated-utility' && (item.data as { className?: string }).className === className,
  );
}

describe('per-package deprecated severity', () => {
  it('uses the global setting when no package entry exists (auto fallback baseline)', () => {
    // pkg-a entries have no per-package entry and no global entry: auto → Information.
    expect(findDeprecation(htmlDoc, undefined, 'deprecated-component')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findDeprecation(htmlDoc, undefined, 'deprecated-attribute')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findDeprecation(htmlDoc, undefined, 'deprecated-value')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findUtility(undefined, 'a-util')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findToken(undefined, '--a-token')?.severity).toBe(DiagnosticSeverity.Information);
  });

  it('prefers the package override over the global setting', () => {
    const config: DSConfig = {
      diagnostics: { deprecated: 'error', packages: { 'pkg-a': { deprecated: 'information' } } },
    };
    // pkg-a symbols use the per-package setting, not the global Error.
    expect(findDeprecation(htmlDoc, config, 'deprecated-component')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findDeprecation(htmlDoc, config, 'deprecated-attribute')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findDeprecation(htmlDoc, config, 'deprecated-value')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findUtility(config, 'a-util')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findToken(config, '--a-token')?.severity).toBe(DiagnosticSeverity.Information);
    // pkg-b symbols still use the global setting.
    expect(findToken(config, '--b-token')?.severity).toBe(DiagnosticSeverity.Error);
    expect(findUtility(config, 'b-util')?.severity).toBe(DiagnosticSeverity.Error);
  });

  it('falls back to the global setting when the package entry is missing', () => {
    const config: DSConfig = {
      diagnostics: { deprecated: 'warning', packages: { 'pkg-b': { deprecated: 'information' } } },
    };
    // pkg-a has no per-package entry → global Warning.
    expect(findDeprecation(htmlDoc, config, 'deprecated-component')?.severity).toBe(DiagnosticSeverity.Warning);
    expect(findUtility(config, 'a-util')?.severity).toBe(DiagnosticSeverity.Warning);
    expect(findToken(config, '--a-token')?.severity).toBe(DiagnosticSeverity.Warning);
    // pkg-b keeps its own setting.
    expect(findToken(config, '--b-token')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findUtility(config, 'b-util')?.severity).toBe(DiagnosticSeverity.Information);
  });

  it('treats an explicit per-package auto as auto severity computation', () => {
    const config: DSConfig = {
      diagnostics: { deprecated: 'error', packages: { 'pkg-b': { deprecated: 'auto' } } },
    };
    // Auto computes Information for the far-future removal (not the global Error).
    expect(findToken(config, '--b-token')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findUtility(config, 'b-util')?.severity).toBe(DiagnosticSeverity.Information);
    // pkg-a still uses the global Error.
    expect(findToken(config, '--a-token')?.severity).toBe(DiagnosticSeverity.Error);
  });

  it('suppresses only the configured package', () => {
    const config: DSConfig = {
      diagnostics: { deprecated: 'error', packages: { 'pkg-a': { deprecated: 'off' } } },
    };
    const html = diagnostics(htmlDoc, config);
    const css = diagnostics(cssDoc, config);
    // No deprecation diagnostics for any pkg-a symbol.
    expect(findComponent(config, 'x-alpha')).toBeUndefined();
    expect(html.find(item => diagnosticType(item) === 'deprecated-attribute')).toBeUndefined();
    expect(html.find(item => diagnosticType(item) === 'deprecated-value')).toBeUndefined();
    expect(html.find(item => diagnosticType(item) === 'deprecated-utility'
      && (item.data as { className?: string }).className === 'a-util')).toBeUndefined();
    expect(findToken(config, '--a-token')).toBeUndefined();
    // Lifecycle issue emission is preserved even with 'off'.
    expect(html.find(item => diagnosticType(item) === 'bare-deprecation')?.severity).toBe(DiagnosticSeverity.Warning);
    // pkg-b is unaffected.
    expect(findComponent(config, 'x-beta')?.severity).toBe(DiagnosticSeverity.Error);
    expect(css.find(item => diagnosticType(item) === 'deprecated-token' && (item.data as { token?: string }).token === '--b-token')?.severity).toBe(DiagnosticSeverity.Error);
    expect(findUtility(config, 'b-util')?.severity).toBe(DiagnosticSeverity.Error);
  });

  it('keeps other packages on their own settings when one package is configured', () => {
    const config: DSConfig = {
      diagnostics: { packages: { 'pkg-b': { deprecated: 'warning' } } },
    };
    // pkg-a: no per-package entry, no global entry → auto Information.
    expect(findDeprecation(htmlDoc, config, 'deprecated-component')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findUtility(config, 'a-util')?.severity).toBe(DiagnosticSeverity.Information);
    expect(findToken(config, '--a-token')?.severity).toBe(DiagnosticSeverity.Information);
    // pkg-b: per-package Warning.
    expect(findUtility(config, 'b-util')?.severity).toBe(DiagnosticSeverity.Warning);
    expect(findToken(config, '--b-token')?.severity).toBe(DiagnosticSeverity.Warning);
  });

  it('keeps removed-state severity unchanged under auto', () => {
    // Removed component → Error with no config and with an explicit auto override.
    expect(findComponent(undefined, 'x-beta')?.severity).toBe(DiagnosticSeverity.Error);
    const config: DSConfig = { diagnostics: { packages: { 'pkg-b': { deprecated: 'auto' } } } };
    expect(findComponent(config, 'x-beta')?.severity).toBe(DiagnosticSeverity.Error);
  });

  it('falls back to the global setting for unsupported runtime values', () => {
    const config = {
      diagnostics: { deprecated: 'warning', packages: { 'pkg-a': { deprecated: 'silent' } } },
    } as unknown as DSConfig;
    expect(findDeprecation(htmlDoc, config, 'deprecated-component')?.severity).toBe(DiagnosticSeverity.Warning);

    const invalidGlobal = { diagnostics: { deprecated: 'loud' } } as unknown as DSConfig;
    expect(findDeprecation(htmlDoc, invalidGlobal, 'deprecated-component')?.severity).toBe(DiagnosticSeverity.Information);
  });
});

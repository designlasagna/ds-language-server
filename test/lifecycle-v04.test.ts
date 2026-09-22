import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { parseCEM } from '../src/parsers/cem.js';
import { parseTokens } from '../src/parsers/tokens.js';
import { parseUtilities } from '../src/parsers/utilities.js';
import { getDeprecationSeverity, normalizeLifecycle } from '../src/lifecycle.js';
import { DSStore } from '../src/store.js';
import { getDiagnostics } from '../src/providers/diagnostics.js';
import { getCodeActions } from '../src/providers/code-actions.js';

type Vector = { id: string; format: string; input: Record<string, unknown>; ancestors?: Record<string, unknown>[]; context?: Record<string, unknown>; expected: Record<string, unknown> };
const vectors = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'node_modules', '@designlasagna', 'schemas', 'examples', 'lifecycle', 'consumer-cases.json'), 'utf8')) as { cases: Vector[] };
const byFormat = (format: string) => vectors.cases.filter(vector => vector.format === format);

function expectLifecycle(actual: { lifecycleState?: string; lifecycleAssertion?: string; deprecationMessage?: string; removal?: string; replacement?: string; status?: string }, expected: Record<string, unknown>): void {
  if ('state' in expected) expect(actual.lifecycleState).toBe(expected.state);
  if ('assertion' in expected) expect(actual.lifecycleAssertion).toBe(expected.assertion);
  if ('message' in expected) expect(actual.deprecationMessage).toBe(expected.message);
  if ('removal' in expected) expect(actual.removal).toBe(expected.removal ?? undefined);
  if ('replacement' in expected) expect(actual.replacement).toBe(expected.replacement ?? undefined);
  if ('status' in expected) expect(actual.status).toBe(expected.status);
}

function dtcgDocument(vector: Vector): Record<string, unknown> {
  if (vector.id === 'extends-before-lifecycle') {
    return { ...(vector.context?.document as Record<string, unknown>), derived: vector.input };
  }
  let child: Record<string, unknown> = { $value: 1 };
  for (const node of [...(vector.ancestors ?? []), vector.input].reverse()) child = { ...node, child };
  return child;
}

/** These cases have no LSP symbol/replacement fixture in the shared artifact; parser conformance is the applicable downstream contract. */
const parserOnlyVectors = new Set(['alias-no-lifecycle-transfer', 'profile-not-selected']);

describe('schemas 0.4 consumer vectors: production normalization and parsers', () => {
  it.each(byFormat('native'))('native $id', (vector) => {
    const result = normalizeLifecycle(vector.input.deprecated, vector.input.status);
    expectLifecycle({ lifecycleState: result.state, lifecycleAssertion: result.assertion, deprecationMessage: result.message, removal: result.removal, replacement: result.replacement, status: result.status }, vector.expected);
    if (vector.expected.severity) {
      const now = vector.context?.now ? new Date(vector.context.now as string) : undefined;
      const severity = getDeprecationSeverity(result.removal, undefined, result.state, now);
      expect(severity).toBe(({ error: DiagnosticSeverity.Error, warning: DiagnosticSeverity.Warning, info: DiagnosticSeverity.Information } as const)[vector.expected.severity as 'error' | 'warning' | 'info']);
    }
    // Replacement-resolution vectors require a store; their actual LSP
    // diagnostics/actions are exercised in the integration case below.
    if (vector.expected.diagnostics && !['unresolved-replacement', 'ambiguous-replacement'].some(issue => vector.expected.diagnostics?.includes(issue))) {
      expect(result.issues).toEqual(expect.arrayContaining(vector.expected.diagnostics));
    }
  });

  it.each(byFormat('dtcg'))('DTCG $id', (vector) => {
    const selected = vector.id !== 'profile-not-selected';
    const tokens = parseTokens(dtcgDocument(vector), 'vectors', selected ? '0.4' : undefined);
    const token = vector.id === 'extends-before-lifecycle'
      ? tokens.find(candidate => candidate.name === '--derived-gap')
      : tokens.at(-1);
    expect(token, `${vector.id} must yield a token through the production parser`).toBeDefined();
    expectLifecycle(token!, vector.expected);
    if (vector.expected.diagnostics) expect(token!.lifecycleIssues).toEqual(expect.arrayContaining(vector.expected.diagnostics));
    // Keep the classification explicit: no vector is counted as action conformance
    // unless it has a complete source/store/document fixture below.
    if (parserOnlyVectors.has(vector.id)) expect(token!.name).toMatch(/^--/);
  });

  it.each(byFormat('cem'))('CEM $id', (vector) => {
    const duplicate = vector.id === 'duplicate-cem-attribute-member-conflict';
    const isComponent = 'tagName' in vector.input;
    const attribute = isComponent || duplicate ? undefined : vector.input;
    const declaration = isComponent || duplicate
      ? { ...vector.input, name: vector.input.name ?? 'Vector', tagName: vector.input.tagName ?? 'x-vector' }
      : { name: 'Vector', tagName: 'x-vector', attributes: [attribute] };
    const [component] = parseCEM({ modules: [{ declarations: [declaration] }] }, 'vectors', '0.4');
    const actual = attribute || duplicate ? component.attributes[0] : component;
    if ('state' in vector.expected) expectLifecycle(actual, vector.expected);
    if ('attributeState' in vector.expected) expect(actual.lifecycleState).toBe(vector.expected.attributeState);
    if ('valueState' in vector.expected) expect(actual.deprecatedValues?.[0]).toMatchObject({ value: vector.context?.usedValue });
    if ('replacement' in vector.expected) expect(actual.deprecatedValues?.[0]?.replacement).toBe(vector.expected.replacement);
    if (vector.expected.diagnostics) expect(actual.lifecycleIssues).toEqual(expect.arrayContaining(vector.expected.diagnostics));
  });
});

describe('v0.4 parser → store → diagnostics → actions', () => {
  function nativeStore(entries: Record<string, unknown>[], profile?: '0.4'): { store: DSStore; document: TextDocument } {
    const root = mkdtempSync(join(tmpdir(), 'dsls-v04-'));
    const tokens = join(root, 'tokens.json');
    writeFileSync(tokens, JSON.stringify({ schemaVersion: '0.4.0', tokens: entries }));
    const store = new DSStore();
    store.load({ components: [], tokens: [{ path: tokens, packageName: 'vectors' }], utilities: [] }, profile ? { lifecycle: { profile } } : undefined);
    return { store, document: TextDocument.create('file:///vector.css', 'css', 1, 'a { color: var(--old); }') };
  }

  it('selects native 0.4 by schemaVersion without config, while legacy native stays legacy', () => {
    const native = nativeStore([{ id: 'old', platforms: { web: { reference: '--old' } }, status: 'removed' }]);
    expect(native.store.getToken('--old')?.lifecycleState).toBe('removed');
    expect(parseUtilities({ schemaVersion: '0.4.0', utilities: [{ name: 'old', status: 'removed' }] }, 'vectors')[0].lifecycleState).toBe('removed');
    const legacy = parseTokens({ tokens: [{ platforms: { web: { reference: '--old' } }, deprecated: false, status: 'deprecated' }] }, 'vectors');
    expect(legacy[0].lifecycleIssues).toBeUndefined();
  });

  it('requires an explicit lifecycle profile for raw DTCG and CEM', () => {
    const dtcg = { group: { $extensions: { 'recipes.designlasagna': { status: 'removed' } }, old: { $value: 1 } } };
    expect(parseTokens(dtcg, 'vectors').find(token => token.name === '--group-old')?.lifecycleState).toBe('active');
    expect(parseTokens(dtcg, 'vectors', '0.4').find(token => token.name === '--group-old')?.lifecycleState).toBe('removed');
    const cem = { modules: [{ declarations: [{ name: 'Old', tagName: 'x-old', deprecated: false, status: 'removed' }] }] };
    expect(parseCEM(cem, 'vectors')[0].lifecycleState).toBe('active');
    expect(parseCEM(cem, 'vectors', '0.4')[0].lifecycleState).toBe('removed');
  });

  it('emits contract diagnostics and suppresses unresolved/ambiguous replacement actions', () => {
    const cases = [
      { id: 'conflict', entry: { id: 'old', platforms: { web: { reference: '--old' } }, deprecated: false, status: 'deprecated' }, type: 'lifecycle-conflict' },
      { id: 'bare', entry: { id: 'old', platforms: { web: { reference: '--old' } }, deprecated: true }, type: 'bare-deprecation' },
      { id: 'unresolved', entry: { id: 'old', platforms: { web: { reference: '--old' } }, deprecated: { message: 'Use next', replacement: 'next' } }, type: 'unresolved-replacement' },
      { id: 'ambiguous', entry: { id: 'old', platforms: { web: { reference: '--old' } }, deprecated: { message: 'Use next', replacement: 'next' } }, extra: [{ id: 'next', platforms: { web: { reference: '--next-a' } } }, { id: 'next', platforms: { web: { reference: '--next-b' } } }], type: 'ambiguous-replacement' },
      { id: 'self', entry: { id: 'old', platforms: { web: { reference: '--old' } }, deprecated: { message: 'Old', replacement: 'old' } } },
      { id: 'cycle', entry: { id: 'a', platforms: { web: { reference: '--old' } }, deprecated: { message: 'Use b', replacement: 'b' } }, extra: [{ id: 'b', platforms: { web: { reference: '--b' } }, deprecated: { message: 'Use a', replacement: 'a' } }] },
      { id: 'removed target', entry: { id: 'old', platforms: { web: { reference: '--old' } }, deprecated: { message: 'Use next', replacement: 'next' } }, extra: [{ id: 'next', platforms: { web: { reference: '--next' } }, status: 'removed' }], type: 'unresolved-replacement' },
    ];
    for (const testCase of cases) {
      const { store, document } = nativeStore([testCase.entry, ...(testCase.extra ?? [])]);
      const diagnostics = getDiagnostics(document, store);
      if (testCase.type) expect(diagnostics.some(diagnostic => (diagnostic.data as { type: string }).type === testCase.type), testCase.id).toBe(true);
      if (testCase.type?.includes('replacement') || ['self', 'cycle'].includes(testCase.id)) expect(getCodeActions(document, diagnostics)).toHaveLength(0);
    }
  });

  it('surfaces DTCG/CEM contract diagnostics through the provider', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsls-v04-contract-'));
    const dtcg = join(root, 'tokens.json');
    const cem = join(root, 'custom-elements.json');
    writeFileSync(dtcg, JSON.stringify({ old: { $deprecated: true, $value: 1 }, mismatch: { $deprecated: 'Old', $extensions: { 'recipes.designlasagna': { deprecated: { message: 'Canonical' } } }, $value: 1 } }));
    writeFileSync(cem, JSON.stringify({ modules: [{ declarations: [{ name: 'Old', tagName: 'x-old', deprecated: 'Use x-new', replacement: 'x-new', attributes: [{ name: 'old-name', deprecated: false }], members: [{ name: 'old-name', deprecated: 'Old' }] }] }] }));
    const store = new DSStore();
    store.load({ components: [{ path: cem, packageName: 'vectors' }], tokens: [{ path: dtcg, packageName: 'vectors' }], utilities: [] }, { lifecycle: { profile: '0.4' } });
    const cssDiagnostics = getDiagnostics(TextDocument.create('file:///vector.css', 'css', 1, 'a { color: var(--old); gap: var(--mismatch); }'), store);
    expect(cssDiagnostics.map(diagnostic => (diagnostic.data as { type: string }).type)).toEqual(expect.arrayContaining(['bare-deprecation', 'deprecation-message-mismatch']));
    const htmlDiagnostics = getDiagnostics(TextDocument.create('file:///vector.html', 'html', 1, '<x-old old-name="x"></x-old>'), store);
    expect(htmlDiagnostics.map(diagnostic => (diagnostic.data as { type: string }).type)).toEqual(expect.arrayContaining(['lifecycle-conflict', 'deprecated-component']));
    expect(getCodeActions(TextDocument.create('file:///vector.html', 'html', 1, '<x-old></x-old>'), htmlDiagnostics.filter(diagnostic => (diagnostic.data as { type: string }).type === 'deprecated-component'))).toHaveLength(0);
  });

  it('expands recursive DTCG groups, honors local overrides, and reports bad $extends safely', () => {
    const document = { base: { $deprecated: 'Base', nested: { $type: 'dimension', gap: { $value: 4 } } }, middle: { $extends: '{base}', nested: { local: { $value: 5 } } }, derived: { $extends: '{middle}', $deprecated: false, nested: { gap: { $value: 8 } } } };
    const tokens = parseTokens(document, 'vectors', '0.4');
    expect(tokens.find(token => token.name === '--derived-nested-gap')).toMatchObject({ lifecycleState: 'active', value: '8' });
    const invalid = parseTokens({ missing: { $extends: '{nope}', old: { $value: 1 } }, a: { $extends: '{b}', old: { $value: 1 } }, b: { $extends: '{a}' } }, 'vectors', '0.4');
    expect(invalid.find(token => token.name === '--missing-old')?.lifecycleIssues).toContain('unresolved-extends');
    expect(invalid.find(token => token.name === '--a-old')?.lifecycleIssues).toContain('extends-cycle');
  });

  it('uses safe token replacements but leaves component replacement diagnostic-only', () => {
    const { store, document } = nativeStore([
      { id: 'old', platforms: { web: { reference: '--old' } }, status: 'removed', deprecated: { message: 'Retired', replacement: 'new' } },
      { id: 'new', platforms: { web: { reference: '--new' } } },
    ]);
    const diagnostics = getDiagnostics(document, store);
    expect(diagnostics.find(diag => (diag.data as { type: string }).type === 'deprecated-token')?.severity).toBe(DiagnosticSeverity.Error);
    expect(getCodeActions(document, diagnostics)[0].edit?.changes?.[document.uri][0].newText).toBe('--new');
  });
});

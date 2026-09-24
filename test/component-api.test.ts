import { describe, it, expect } from 'vitest';
import { CompletionItemTag } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseCEM } from '../src/parsers/cem.js';
import { getCursorContext, scanDocument } from '../src/scanner.js';
import { getCompletions } from '../src/providers/completion.js';
import { getHover } from '../src/providers/hover.js';
import { getDiagnostics } from '../src/providers/diagnostics.js';
import { getCodeActions } from '../src/providers/code-actions.js';
import { classMapRanges } from '../src/class-map.js';
import type { DSStore } from '../src/store.js';

const components = parseCEM({ modules: [{ declarations: [{
  tagName: 'ds-box', name: 'DSBox',
  members: [
    { name: 'value', kind: 'field', type: { text: 'number' } },
    { name: 'oldValue', kind: 'field', deprecated: 'Use value.' },
    { name: 'privateValue', kind: 'field', privacy: 'private' },
    { name: 'protectedValue', kind: 'field', privacy: 'protected' },
    { name: 'staticValue', kind: 'field', static: true },
    { name: 'readonlyValue', kind: 'field', readonly: true },
    { name: 'methodValue', kind: 'method' },
  ],
  events: [{ name: 'change', type: { text: 'CustomEvent<number>' } }, { name: 'old-change', deprecated: 'Use change.' }],
  cssParts: [{ name: 'label', description: 'Label surface' }, { name: 'old-label', deprecated: 'Use label.' }],
  cssProperties: [{ name: '--box-color', default: 'red' }, { name: '--shared', description: 'Local property' }],
}, { tagName: 'ds-other', name: 'DSOther', cssParts: [{ name: 'secret' }], cssProperties: [{ name: '--other-secret' }] }] }] }, 'pkg', '0.4');
const utilities = [
  { name: 'old-util', source: 'pkg', deprecated: true, replacement: 'new-util', deprecationMessage: 'Use new-util.' },
  { name: 'new-util', source: 'pkg' },
];
const tokens = [{ name: '--global', source: 'pkg' }, { name: '--shared', source: 'pkg' }];
const store = {
  getComponent: (name: string) => components.find(c => c.tagName === name),
  getComponentByClassName: (name: string) => components.find(c => c.className === name),
  getComponents: () => components,
  getTokens: () => tokens,
  getToken: (name: string) => tokens.find(t => t.name === name),
  getUtilities: () => utilities,
  getUtility: (name: string) => utilities.find(u => u.name === name),
} as unknown as DSStore;
const document = (text: string, language = 'typescript') => TextDocument.create('file:///test.ts', language, 1, text);
const complete = (text: string, language = 'typescript') => getCompletions(getCursorContext(document(text, language), text.length), store);

describe('component API completion', () => {
  it('parses public writable fields without requiring reflected attributes', () => {
    expect(components[0].attributes).toEqual([]);
    expect(components[0].properties?.map(p => p.name)).toEqual(['value', 'oldValue']);
  });
  it('accepts explicit fields and legacy omitted kinds, but rejects accessors and methods', () => {
    const [component] = parseCEM({ modules: [{ declarations: [{
      name: 'Kinds', tagName: 'ds-kinds', members: [
        { name: 'field', kind: 'field' },
        { name: 'legacy' },
        { name: 'getter', kind: 'getter' },
        { name: 'setter', kind: 'setter' },
        { name: 'method', kind: 'method' },
      ],
    }] }] }, 'pkg');
    expect(component.properties?.map(property => property.name)).toEqual(['field', 'legacy']);
  });
  it('completes Lit properties with a literal JS interpolation snippet', () => {
    const items = complete('html`<ds-box .va');
    expect(items.map(i => i.label)).toEqual(['value']);
    expect(items[0].insertText).toBe('value=\\${${1}}');
  });
  it('completes events and propagates deprecated tags', () => {
    expect(complete('html`<ds-box .value=${value} @cha').map(i => i.label)).toEqual(['change']);
    const old = complete('html`<ds-box @old-')[0];
    expect(old.tags).toContain(CompletionItemTag.Deprecated);
    expect(old.detail).not.toBe('undefined');
  });
  it('does not offer Lit members in quoted values, outside tags or unknown components', () => {
    expect(complete('html`<ds-box title=".va')).toEqual([]);
    expect(complete('const value = ".va')).toEqual([]);
    expect(complete('html`<ds-missing .va')).toEqual([]);
  });
  it('completes parts of a single explicit custom-element selector', () => {
    expect(complete('ds-box::part(la', 'css').map(i => i.label)).toEqual(['label']);
    expect(complete('css`ds-box:hover::part(old-')[0].tags).toContain(CompletionItemTag.Deprecated);
  });
  it('does not leak parts for global, multiple or descendant selectors', () => {
    for (const selector of ['.unknown', 'ds-other ds-box', 'ds-other, ds-box', 'ds-other,\nds-box', ':is(ds-box)', 'div']) {
      expect(complete(`${selector}::part(`, 'css')).toEqual([]);
    }
  });
  it('adds only scoped properties, deduplicating global token names', () => {
    const items = complete('ds-box { color: var(--', 'css');
    expect(items.map(i => i.label).sort()).toEqual(['--box-color', '--global', '--shared']);
    expect(items.find(i => i.label === '--shared')?.documentation).toMatchObject({ value: expect.stringContaining('Local property') });
    expect(complete(':root { color: var(--', 'css').map(i => i.label).sort()).toEqual(['--global', '--shared']);
  });
  it('supports media wrappers without guessing ambiguous rule ownership', () => {
    expect(complete('@media (min-width: 1px) { ds-box { color: var(--box', 'css').map(i => i.label)).toEqual(['--box-color']);
    expect(complete('ds-box, ds-other { color: var(--box', 'css')).toEqual([]);
    expect(complete('ds-box { & .child { color: var(--box', 'css')).toEqual([]);
  });
});

describe('Lit classMap static keys', () => {
  const source = 'html`<ds-box class=${classMap({ "old-util": condition, "new-util": fn({ nested: true }), [dynamic]: other, ...rest })}>`';
  it('recognizes only static keys, never values, computed keys or spreads', () => {
    expect(classMapRanges(source, ['class']).map(r => source.slice(r.start, r.end))).toEqual(['old-util', 'new-util']);
  });
  it('never treats regex body text or nested value keys as classMap keys', () => {
    const text = 'html`<x-box class=${classMap({ "first": /, "old-util": true,/.test(x), "last": fn({ "old-util": 1 }) })}>`';
    expect(classMapRanges(text, ['class']).map(r => text.slice(r.start, r.end))).toEqual(['first', 'last']);
    expect(getDiagnostics(document(text), store)).toEqual([]);
  });
  it('preserves status-only and custom member lifecycle in completion data', () => {
    const parsed = parseCEM({ modules: [{ declarations: [{ name: 'State', tagName: 'ds-state', members: [
      { name: 'old', kind: 'field', status: 'removed' },
      { name: 'custom', kind: 'field', status: 'team-preview' },
    ] }] }] }, 'pkg', '0.4');
    expect(parsed[0].properties?.[0]).toMatchObject({ name: 'old', status: 'removed', lifecycleState: 'removed' });
    expect(parsed[0].properties?.[1]).toMatchObject({ name: 'custom', status: 'team-preview', lifecycleState: 'active' });
  });
  it('scans and hovers at original static-key offsets', () => {
    const doc = document(source);
    const symbols = scanDocument(doc, new Set(['ds-box']), new Set(), new Set(utilities.map(u => u.name)));
    expect(symbols.filter(s => s.kind === 'class').map(s => [s.name, s.start])).toEqual([
      ['old-util', source.indexOf('old-util')], ['new-util', source.indexOf('new-util')],
    ]);
    expect(getHover(doc, doc.positionAt(source.indexOf('old-util') + 2), store)?.contents).toMatchObject({ value: expect.stringContaining('old-util') });
  });
  it('produces diagnostics and safe edits only on the authored key', () => {
    const doc = document(source);
    const diagnostics = getDiagnostics(doc, store);
    const old = diagnostics.find(d => d.data?.type === 'deprecated-utility');
    expect(old).toBeDefined();
    expect(doc.getText(old!.range)).toBe('old-util');
    const actions = getCodeActions(doc, [old!]);
    expect(actions).toHaveLength(1);
    const edits = actions[0].edit?.changes?.[doc.uri];
    expect(edits?.[0].newText).toBe('new-util');
    expect(edits?.[0].range).toEqual(old!.range);
  });
  it('supports completion inside an unfinished quoted object key', () => {
    expect(complete('html`<ds-box class=${classMap({ "old-').map(i => i.label)).toEqual(['old-util']);
  });
  it('honors configured attributes and template tags', () => {
    const config = { classAttributes: ['utility'], templateTags: { html: ['view'] } };
    const custom = source.replace('html`', 'view`').replace('class=', 'utility=');
    const doc = document(custom);
    expect(getDiagnostics(doc, store, config).some(d => d.data?.type === 'deprecated-utility')).toBe(true);
    expect(getDiagnostics(doc, store).some(d => d.data?.type === 'deprecated-utility')).toBe(false);
    expect(getDiagnostics(document(source), store, { classAttributes: [] })).toEqual([]);
  });
  it('does not offer utility completions in arbitrary interpolation expressions or classMap values', () => {
    expect(complete('html`<ds-box class="${arbitrary')).toEqual([]);
    expect(complete('html`<ds-box class="${classMap({ "old-util": condition')).toEqual([]);
    expect(complete('html`<ds-box class="${arbitrary} old-').map(i => i.label)).toEqual(['old-util']);
  });
  it('does not recognize classMap in strings, comments, unrelated calls or values', () => {
    for (const text of [JSON.stringify(source), '// ' + source, 'other`<ds-box class=${classMap({ "old-util": true })}>`', 'const classes = classMap({ "old-util": true })']) {
      expect(getDiagnostics(document(text), store)).toEqual([]);
    }
  });
});

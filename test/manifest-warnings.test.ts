import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { collectUnknownFields, formatUnknownFieldsLog, type ManifestKind } from '../src/providers/manifest-warnings.js';
import { getSchemaDiagnostics } from '../src/providers/schema-diagnostics.js';

function unknown(manifest: unknown, kind: ManifestKind = 'tokens') {
  return collectUnknownFields({ schemaVersion: '0.4.0', ...(manifest as object) }, kind);
}

const token = (extra: object = {}) => ({ tokens: [{ id: 'color.primary', resolved: { base: '#06c' }, ...extra }] });
const utility = (extra: object = {}, root: object = {}) => ({ utilities: [{ name: 'u-pad', ...extra }], ...root });

describe('collectUnknownFields', () => {
  it('lists unknown token fields by token id', () => {
    expect(unknown(token({ foo: 1, bar: 2 }))).toEqual(['tokens["color.primary"].foo', 'tokens["color.primary"].bar']);
  });

  it('lists unknown manifest root, utility and icon fields', () => {
    expect(unknown({ ...token(), generatedAtt: 'x' })).toEqual(['generatedAtt']);
    expect(unknown(utility({ keywrds: [] }), 'utilities')).toEqual(['utilities["u-pad"].keywrds']);
    expect(unknown({ icons: [{ name: 'a', categry: 'x' }] }, 'icons')).toEqual(['icons["a"].categry']);
  });

  it('knows fields inherited through allOf in deprecation records', () => {
    expect(unknown(token({ deprecated: { message: 'x', replacment: 'a' } }))).toEqual(['tokens["color.primary"].deprecated.replacment']);
    expect(unknown(token({ deprecated: { message: 'x', replacement: 'a', removal: '2027-01-01' } }))).toEqual([]);
  });

  it('skips metadata, platforms, modes, resolved and conditions', () => {
    expect(unknown({
      conditions: { anyCustomName: { values: ['light'] } },
      collections: { anyCollection: { name: 'x' } },
      ...token({
        metadata: { anything: { goes: true } },
        platforms: { css: { reference: 'var(--x)' }, ios: { reference: 'x' } },
        modes: { dark: '#000' },
        resolved: { base: '#06c', dark: '#000' },
      }),
    })).toEqual([]);
  });

  it('skips open platform entries and variant kinds of utilities', () => {
    expect(unknown(utility({ platforms: { css: { className: 'u', vendor: 'x' } } }), 'utilities')).toEqual([]);
    expect(unknown(utility({ variants: { density: ['compact'] } }, { variantPatterns: { density: { pattern: 'x' } } }), 'utilities')).toEqual([]);
  });

  it('ignores manifests that are not native v0.4', () => {
    expect(collectUnknownFields({ schemaVersion: '0.3.0', tokens: [{ id: 'a', foo: 1 }] }, 'tokens')).toEqual([]);
    expect(collectUnknownFields([], 'tokens')).toEqual([]);
  });
});

describe('formatUnknownFieldsLog', () => {
  it('formats one concise line', () => {
    expect(formatUnknownFieldsLog('node_modules/@acme/ds/tokens.json', ['a.foo', 'b.bar'])).toBe(
      '[manifest] node_modules/@acme/ds/tokens.json: fields not used by the language server: a.foo, b.bar',
    );
  });

  it('truncates after ten fields', () => {
    const fields = Array.from({ length: 13 }, (_, i) => `f${i}`);
    const line = formatUnknownFieldsLog('t.json', fields)!;
    expect(line).toContain('f9 and 3 more');
    expect(line).not.toContain('f10');
  });

  it('returns nothing when there are no unknown fields', () => {
    expect(formatUnknownFieldsLog('t.json', [])).toBeUndefined();
  });
});

describe('open schemas', () => {
  it('produces no diagnostics for unknown fields', () => {
    const text = JSON.stringify({ schemaVersion: '0.4.0', foo: 1, ...token({ bar: 2, deprected: { message: 'x' } }) }, null, 2);
    const doc = TextDocument.create('file:///tokens.json', 'json', 1, text);
    expect(getSchemaDiagnostics(doc)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getManifestWarnings, type ManifestKind } from '../src/providers/manifest-warnings.js';
import { getSchemaDiagnostics } from '../src/providers/schema-diagnostics.js';
import { isRecognisedRemoval } from '../src/lifecycle.js';

function warnings(manifest: unknown, kind: ManifestKind = 'tokens') {
  const text = JSON.stringify({ schemaVersion: '0.4.0', ...(manifest as object) }, null, 2);
  const doc = TextDocument.create('file:///manifest.json', 'json', 1, text);
  return getManifestWarnings(doc, kind).map((d) => ({ ...d, text: doc.getText(d.range) }));
}

const token = (extra: object = {}) => ({ tokens: [{ id: 'color.primary', resolved: { base: '#06c' }, ...extra }] });
const utility = (extra: object = {}, root: object = {}) => ({ utilities: [{ name: 'u-pad', ...extra }], ...root });

describe('unknown field warnings', () => {
  it('warns on an unknown token field with a suggestion', () => {
    const [warning, ...rest] = warnings(token({ deprected: { message: 'x' } }));
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({
      severity: DiagnosticSeverity.Warning,
      code: 'unknown-field',
      text: '"deprected"',
      message: '`deprected` is not a known field — did you mean `deprecated`?',
    });
  });

  it('warns without a suggestion when nothing is close', () => {
    const [warning] = warnings(token({ completelyCustom: 1 }));
    expect(warning.message).toBe('`completelyCustom` is not a known field.');
  });

  it('warns on unknown manifest root, utility and icon fields', () => {
    expect(warnings({ ...token(), generatedAtt: 'x' }).map((w) => w.text)).toEqual(['"generatedAtt"']);
    expect(warnings(utility({ keywrds: [] }), 'utilities')[0].message).toContain('did you mean `keywords`?');
    expect(warnings({ icons: [{ name: 'a', categry: 'x' }] }, 'icons')[0].message).toContain('did you mean `category`?');
  });

  it('warns inside deprecation records via fields inherited through allOf', () => {
    const [warning] = warnings(token({ deprecated: { message: 'x', replacment: 'a' } }));
    expect(warning.message).toContain('did you mean `replacement`?');
    expect(warnings(token({ deprecated: { message: 'x', replacement: 'a', removal: '2027-01-01' } }))).toEqual([]);
  });

  it('does not warn inside metadata, platforms, modes, resolved or conditions', () => {
    expect(warnings({
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

  it('does not warn for open platform entries of utilities and icons', () => {
    expect(warnings(utility({ platforms: { css: { className: 'u', vendor: 'x' } } }), 'utilities')).toEqual([]);
    expect(warnings({ icons: [{ name: 'a', platforms: { web: { import: 'a', vendor: 'x' } } }] }, 'icons')).toEqual([]);
  });

  it('ignores manifests that are not v0.4', () => {
    const doc = TextDocument.create('file:///m.json', 'json', 1, JSON.stringify({ schemaVersion: '0.3.0', tokens: [{ id: 'a', bogus: 1 }] }));
    expect(getManifestWarnings(doc, 'tokens')).toEqual([]);
  });

  it('returns nothing for unparseable documents', () => {
    expect(getManifestWarnings(TextDocument.create('file:///m.json', 'json', 1, '{ "tokens": ['), 'tokens')).toEqual([]);
  });
});

describe('removal format warnings', () => {
  it('accepts dates, SemVer and both quarter forms', () => {
    for (const value of ['2026-12-31', '2024-02-29', '1.2.3', '2.0.0-rc.1', '1.0.0+build.5', '1.0.0-beta.2+exp.sha', '2027-Q1', 'Q4-2026']) {
      expect(isRecognisedRemoval(value), value).toBe(true);
    }
  });

  it('rejects impossible dates and other formats', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-1-1', '1.2', '01.2.3', '2026-Q5', 'Q0-2026', 'soon', 'v2', '']) {
      expect(isRecognisedRemoval(value), value).toBe(false);
    }
  });

  it('warns on the removal value of a deprecation record', () => {
    const [warning, ...rest] = warnings(token({ deprecated: { message: 'x', removal: '2026-02-30' } }));
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({
      severity: DiagnosticSeverity.Warning,
      code: 'invalid-removal',
      text: '"2026-02-30"',
      message: '`removal` isn\'t a recognised date, version or quarter; time-based severity won\'t apply.',
    });
    expect(warnings(utility({ deprecated: { message: 'x', removal: 'next spring' } }), 'utilities')[0].code).toBe('invalid-removal');
    expect(warnings({ icons: [{ name: 'a', deprecated: { message: 'x', removal: '??' } }] }, 'icons')[0].code).toBe('invalid-removal');
  });

  it('does not warn for valid values or an absent removal', () => {
    expect(warnings(token({ deprecated: { message: 'x', removal: 'Q3-2027' } }))).toEqual([]);
    expect(warnings(token({ deprecated: { message: 'x' } }))).toEqual([]);
    expect(warnings(token({ deprecated: false }))).toEqual([]);
  });
});

describe('undeclared variant kinds', () => {
  it('warns for a kind missing from variantPatterns', () => {
    const [warning, ...rest] = warnings(utility({ variants: { states: true, responsive: true, print: true } }), 'utilities');
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({ severity: DiagnosticSeverity.Warning, code: 'undeclared-variant-kind', text: '"print"' });
  });

  it('accepts states, responsive and declared kinds', () => {
    expect(warnings(utility(
      { variants: { states: ['hover'], responsive: true, colorScheme: true } },
      { variantPatterns: { colorScheme: { format: 'dark:{utility}' } } },
    ), 'utilities')).toEqual([]);
  });
});

describe('suspicious values', () => {
  it('warns on an empty wcagContrast map', () => {
    const [warning, ...rest] = warnings(token({ a11y: { wcagContrast: {} } }));
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({ severity: DiagnosticSeverity.Warning, code: 'suspicious-value', text: '{}' });
  });

  it('accepts a populated wcagContrast map', () => {
    expect(warnings(token({ a11y: { wcagContrast: { light: { ratio: 4.5, against: '#fff', level: 'AA' } } } }))).toEqual([]);
  });

  it('warns on an empty utility platform entry only', () => {
    const [warning, ...rest] = warnings(utility({ platforms: { css: { className: 'u' }, ios: {} } }), 'utilities');
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({ code: 'suspicious-value', text: '{}' });
    expect(warning.message).toContain('`ios`');
  });
});

describe('token document integration', () => {
  it('appends warnings to schema diagnostics for v0.4 manifests without making them errors', () => {
    const doc = TextDocument.create('file:///tokens.json', 'json', 1, JSON.stringify({
      schemaVersion: '0.4.0',
      tokens: [{ id: 'color.primary', resolved: { base: '#06c' }, deprected: true }],
    }));
    const diagnostics = getSchemaDiagnostics(doc);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: DiagnosticSeverity.Warning, code: 'unknown-field' });
  });

  it('does not warn on DTCG documents', () => {
    const doc = TextDocument.create('file:///tokens.json', 'json', 1, '{ "size": { "$type": "dimension", "$value": { "value": 1, "unit": "px" }, "bogus": 1 } }');
    expect(getSchemaDiagnostics(doc).filter((d) => d.severity === DiagnosticSeverity.Warning)).toEqual([]);
  });
});

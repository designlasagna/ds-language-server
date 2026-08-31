import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getSchemaDiagnostics } from '../src/providers/schema-diagnostics.js';

function document(text: string): TextDocument {
  return TextDocument.create('file:///tokens.json', 'json', 1, text);
}

describe('getSchemaDiagnostics', () => {
  it('returns no diagnostics for a valid manifest', () => {
    expect(getSchemaDiagnostics(document(JSON.stringify({
      schemaVersion: '0.3.0',
      tokens: [{ id: 'color.primary', resolved: { base: '#0066cc' } }],
    })))).toEqual([]);
  });

  it('uses concise messages and the exact invalid-value range for type errors', () => {
    const text = JSON.stringify({
      schemaVersion: '0.3.0',
      tokens: [{ id: 'color.primary', resolved: { base: false } }],
    }, null, 2);
    const doc = document(text);
    const diagnostic = getSchemaDiagnostics(doc).find((item) => item.message === 'Expected a `string` value.');

    expect(diagnostic).toMatchObject({ source: 'designlasagna-schema', code: 'schema-manifest' });
    expect(doc.getText(diagnostic?.range)).toBe('false');
  });

  it('targets the insertion point in the containing object for missing properties', () => {
    const text = '{\n  "schemaVersion": "0.3.0",\n  "tokens": [\n    { "id": "color.primary" }\n  ]\n}';
    const doc = document(text);
    const diagnostic = getSchemaDiagnostics(doc).find((item) => item.message === 'Missing required property `resolved`.');

    expect(diagnostic).toMatchObject({ source: 'designlasagna-schema', code: 'schema-manifest' });
    expect(diagnostic?.range.start).toEqual(diagnostic?.range.end);
    expect(doc.offsetAt(diagnostic!.range.start)).toBe(text.indexOf('}', text.indexOf('color.primary')));
  });

  it('formats enum and additional-property errors and targets the offending property', () => {
    const enumDoc = document('{ "size": { "$type": "dimension", "$value": { "value": 1, "unit": "bogus" } } }');
    const enumDiagnostic = getSchemaDiagnostics(enumDoc).find((item) => item.message === 'Expected one of: `px`, `rem`.');
    expect(enumDiagnostic).toMatchObject({ source: 'designlasagna-schema', code: 'schema-dtcg' });
    expect(enumDoc.getText(enumDiagnostic?.range)).toBe('"bogus"');

    const additionalDoc = document('{ "size": { "$extensions": { "recipes.designlasagna": { "unexpected": true } } } }');
    const additionalDiagnostic = getSchemaDiagnostics(additionalDoc).find((item) => item.message === 'Property `unexpected` is not allowed.');
    expect(additionalDiagnostic).toMatchObject({
      source: 'designlasagna-schema',
      code: 'schema-designlasagna-extension',
    });
    expect(additionalDoc.getText(additionalDiagnostic?.range)).toBe('true');
  });

  it('accepts extension-free DTCG source', () => {
    expect(getSchemaDiagnostics(document(JSON.stringify({
      number: { $type: 'number', $value: 1 },
    })))).toEqual([]);
  });

  it('retains malformed-JSON diagnostics with their parser range', () => {
    const doc = document('{ "number": ');
    const [diagnostic] = getSchemaDiagnostics(doc);
    expect(diagnostic).toMatchObject({
      code: 'invalid-json',
      source: 'designlasagna-schema',
      message: 'Invalid JSON: ValueExpected',
    });
    expect(diagnostic?.range).toEqual({
      start: { line: 0, character: 12 },
      end: { line: 0, character: 12 },
    });
  });
});

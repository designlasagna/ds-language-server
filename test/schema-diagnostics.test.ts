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

  it('highlights the invalid field rather than the file root', () => {
    const diagnostics = getSchemaDiagnostics(document(JSON.stringify({
      schemaVersion: '0.3.0',
      tokens: [{ id: 'color.primary', resolved: { base: false } }],
    }, null, 2)));
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'designlasagna-schema',
        code: 'schema-manifest',
        message: expect.stringContaining('/tokens/0/resolved/base'),
      }),
    ]));
    expect(diagnostics[0]?.range.start.line).toBeGreaterThan(0);
  });

  it('accepts extension-free DTCG source', () => {
    expect(getSchemaDiagnostics(document(JSON.stringify({
      number: { $type: 'number', $value: 1 },
    })))).toEqual([]);
  });

  it('reports syntax errors with their source range', () => {
    const diagnostics = getSchemaDiagnostics(document('{ "number": '));
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-json', source: 'designlasagna-schema' }),
    ]));
  });
});

import { describe, expect, it } from 'vitest';
import { detectTokenDocumentFormat } from '../src/token-document.js';

describe('detectTokenDocumentFormat', () => {
  it('detects a Design Lasagna manifest by its tokens array', () => {
    expect(detectTokenDocumentFormat({ schemaVersion: '0.3.0', tokens: [] })).toBe('manifest');
  });

  it('detects extension-free DTCG source', () => {
    expect(detectTokenDocumentFormat({ color: { primary: { $value: '#0066cc' } } })).toBe('dtcg');
  });

  it('detects DTCG source with a Design Lasagna extension', () => {
    expect(
      detectTokenDocumentFormat({
        color: {
          $extensions: { 'recipes.designlasagna': { label: 'Color' } },
          primary: { $value: '#0066cc' },
        },
      }),
    ).toBe('dtcg');
  });

  it('treats a DTCG group named tokens as DTCG, not a manifest', () => {
    expect(detectTokenDocumentFormat({ tokens: { primary: { $value: '#0066cc' } } })).toBe('dtcg');
  });

  it.each([null, [], 'tokens', 1, true])('rejects invalid root value %#', (document) => {
    expect(detectTokenDocumentFormat(document)).toBe('unknown');
  });
});

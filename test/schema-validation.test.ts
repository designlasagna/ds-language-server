import { describe, expect, it } from 'vitest';
import { validateTokenDocument } from '../src/schema-validation.js';

describe('validateTokenDocument', () => {
  it('accepts a valid Design Lasagna manifest', () => {
    expect(validateTokenDocument({
      schemaVersion: '0.3.0',
      tokens: [{ id: 'color.primary', resolved: { base: '#0066cc' } }],
    })).toEqual([]);
  });

  it('reports an invalid manifest with its JSON Pointer', () => {
    const errors = validateTokenDocument({ schemaVersion: '0.3.0', tokens: [{ id: 'color.primary' }] });
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ format: 'manifest', schema: 'manifest', instancePath: '/tokens/0' }),
    ]));
  });

  it('accepts extension-free DTCG source', () => {
    expect(validateTokenDocument({ number: { $type: 'number', $value: 1 } })).toEqual([]);
  });

  it('reports invalid DTCG source', () => {
    const errors = validateTokenDocument({ 'invalid.token': { $value: 1 } });
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ format: 'dtcg', schema: 'dtcg' }),
    ]));
  });

  it('accepts a valid Design Lasagna group extension when present', () => {
    expect(validateTokenDocument({
      color: {
        $extensions: { 'recipes.designlasagna': { label: 'Color' } },
        primary: { $type: 'number', $value: 1 },
      },
    })).toEqual([]);
  });

  it('reports an invalid Design Lasagna extension at its containing node', () => {
    const errors = validateTokenDocument({
      color: {
        $extensions: { 'recipes.designlasagna': { unknown: true } },
        primary: { $type: 'number', $value: 1 },
      },
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schema: 'designlasagna-extension',
        instancePath: '/color/$extensions/recipes.designlasagna',
      }),
    ]));
  });

  it('ignores foreign DTCG extensions', () => {
    expect(validateTokenDocument({
      number: {
        $extensions: { 'com.example.foreign': { any: ['shape'] } },
        $type: 'number',
        $value: 1,
      },
    })).toEqual([]);
  });
});

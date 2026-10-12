import { describe, expect, it } from 'vitest';
import { displayValue, parseTokens } from '../src/parsers/tokens.js';

const manifest = (resolved: Record<string, unknown>) => ({
  schemaVersion: '0.4.0',
  tokens: [{ id: 'shadow.raised', platforms: { web: { reference: '--shadow-raised' } }, resolved }],
});

describe('resolved values shown in hovers and completions', () => {
  it('joins the layers of a multi-layer shadow', () => {
    const [token] = parseTokens(manifest({ base: ['0px 2px 4px 0px #000000', 'inset 0px 8px 4px 0px #000000'] }), 'pkg');
    expect(token.value).toBe('0px 2px 4px 0px #000000, inset 0px 8px 4px 0px #000000');
  });

  it('lists the fields of a composite value', () => {
    const [token] = parseTokens(manifest({ base: { color: '#000000', width: '1px', style: 'solid' } }), 'pkg');
    expect(token.value).toBe('color: #000000; width: 1px; style: solid');
  });

  it('shows every mode as text', () => {
    const [token] = parseTokens(manifest({ light: { fontWeight: 400 }, dark: ['#ff0000 0%', '#0000ff 100%'] }), 'pkg');
    expect(token.resolved).toEqual({ light: 'fontWeight: 400', dark: '#ff0000 0%, #0000ff 100%' });
  });

  it('never renders "[object Object]"', () => {
    for (const value of [{ a: { b: 1 } }, [{ a: 1 }], { list: ['x', 'y'] }]) {
      expect(displayValue(value)).not.toContain('[object Object]');
    }
    expect(displayValue({ a: { b: 1 } })).toBe('a: { b: 1 }');
    expect(displayValue(null)).toBeUndefined();
  });
});

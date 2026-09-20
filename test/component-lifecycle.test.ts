import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCEM } from '../src/parsers/cem.js';
import { DSStore } from '../src/store.js';
import { tryTagHover } from '../src/providers/hover/tag.js';
import { trySlotValueHover } from '../src/providers/hover/slot-value.js';

const path = join(import.meta.dirname, 'fixtures/component-lifecycle.json');
const fixture = () => JSON.parse(readFileSync(path, 'utf8'));

describe('Design Lasagna CEM lifecycle', () => {
  it('preserves component and slot migration metadata', () => {
    const [component] = parseCEM(fixture(), '@test/components');
    expect(component).toMatchObject({ status: 'deprecated', deprecated: true, replacement: 'acme-button', removal: 'v2.0.0' });
    expect(component.slots[1]).toMatchObject({ deprecated: true, deprecationMessage: 'Use the start slot instead.', replacement: 'start', removal: 'v2.0.0' });
    expect(component.slots[3].deprecated).toBe(true);
  });

  it.each(['experimental', 'rc', 'stable', 'removed', 'deprecated', 'custom-status'])('preserves %s status without a deprecated field', (status) => {
    const manifest = fixture();
    const decl = manifest.modules[0].declarations[0];
    decl.status = status;
    delete decl.deprecated;
    const [component] = parseCEM(manifest, '@test/components');
    expect(component.status).toBe(status);
    expect(component.deprecated).toBe(['deprecated', 'removed'].includes(status));
  });

  it('respects an explicit false deprecated flag', () => {
    const manifest = fixture();
    manifest.modules[0].declarations[0].deprecated = false;
    expect(parseCEM(manifest, 'test')[0].deprecated).toBe(false);
  });

  it('shows a compact slot warning and migration details on slot hover', () => {
    const store = new DSStore();
    store.load({ components: [{ path, packageName: '@test/components' }], tokens: [], utilities: [] });
    expect(tryTagHover('<acme-legacy-button>', 3, store)?.contents).toMatchObject({
      value: expect.stringContaining('`icon` **Deprecated** — Leading icon.'),
    });
    expect(tryTagHover('<acme-legacy-button>', 3, store)?.contents).toMatchObject({
      value: expect.stringContaining('**Replacement:** `acme-button`'),
    });
    const text = '<acme-legacy-button><span slot="icon">';
    expect(trySlotValueHover(text, text.indexOf('icon') + 1, store)?.contents).toMatchObject({
      value: expect.stringContaining('**Deprecated**\n\nUse the start slot instead.\n\n**Replacement:** `start`'),
    });
  });
});

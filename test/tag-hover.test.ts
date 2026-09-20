import { describe, expect, it, vi } from 'vitest';
import { DSStore } from '../src/store.js';
import type { DSComponent } from '../src/types.js';
import { tryTagHover } from '../src/providers/hover/tag.js';

function hover(overrides: Partial<DSComponent> = {}, text = '<acme-button>') {
  const component: DSComponent = {
    tagName: 'acme-button',
    className: 'AcmeButton',
    description: 'Triggers an action.\n\nExtended usage documentation.',
    status: 'ready',
    source: '@test/components',
    attributes: [
      { name: 'variant', htmlName: 'variant', type: 'string' },
      { name: 'legacy', htmlName: 'legacy', type: 'boolean', deprecated: true },
    ],
    slots: [{ name: '', description: 'Button label' }, { name: 'prefix', description: 'Before the label. Useful for icons.' }, { name: 'suffix' }],
    events: [],
    cssProperties: [],
    cssParts: [],
    ...overrides,
  };
  const store = new DSStore();
  vi.spyOn(store, 'getComponent').mockImplementation((name) =>
    name === component.tagName ? component : undefined);
  vi.spyOn(store, 'getComponentByClassName').mockReturnValue(component);
  return tryTagHover(text, 3, store)?.contents;
}

describe('compact component hover', () => {
  it.each(['<acme-button>', '<AcmeButton>'])('shows only the summary and slots for %s', (text) => {
    expect(hover({}, text)).toEqual({
      kind: 'markdown',
      value: '### `<acme-button>`\n\nTriggers an action.\n\n**Slots:**\n- `default` — Button label\n- `prefix` — Before the label. Useful for icons.\n- `suffix`',
    });
  });

  it('omits empty descriptions and slots', () => {
    expect(hover({ description: '  ', slots: [], status: undefined })).toEqual({
      kind: 'markdown', value: '### `<acme-button>`',
    });
  });

  it('handles CRLF paragraph breaks', () => {
    expect(hover({ description: 'Summary.\r\n\r\nDetails.', slots: [] })).toEqual({
      kind: 'markdown', value: '### `<acme-button>`\n\nSummary.',
    });
  });

  it.each(['draft', 'beta'] as const)('preserves %s status', (status) => {
    expect(hover({ status })).toMatchObject({ value: expect.stringContaining(`**Status:** ${status}`) });
  });

  it.each([{ status: 'deprecated' as const }, { deprecated: true }])('preserves actionable deprecation information: %j', (lifecycle) => {
    expect(hover({ ...lifecycle, deprecationMessage: 'Use the new button.', replacement: 'acme-action' }))
      .toMatchObject({ value: expect.stringContaining('**Deprecated**\n\nUse the new button.\n\n**Replacement:** `acme-action`') });
  });
});

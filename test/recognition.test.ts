import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { join } from 'node:path';
import { DSStore } from '../src/store.js';
import { getHover } from '../src/providers/hover.js';
import { findParentCustomElement } from '../src/recognition.js';
import { scanDocument } from '../src/scanner.js';

const document = (text: string, languageId = 'html') =>
  TextDocument.create('file:///test', languageId, 1, text);

describe('custom-element recognition', () => {
  it('finds the innermost parent across nested same-name elements and incomplete input', () => {
    const text = '<acme-card><acme-card><span slot="header">';
    expect(findParentCustomElement(text, text.length)).toBe('acme-card');
    expect(findParentCustomElement('<acme-card><span', 16)).toBe('acme-card');
    expect(findParentCustomElement('</acme-card>', 12)).toBeUndefined();
  });
});

describe('hover dispatch', () => {
  const store = new DSStore();
  const fixtures = join(import.meta.dirname, 'fixtures');
  store.load({
    components: [{ path: join(fixtures, 'custom-elements.json'), packageName: '@test/components' }],
    tokens: [{ path: join(fixtures, 'tokens.json'), packageName: '@test/tokens' }],
    utilities: [{ path: join(fixtures, 'utilities.manifest.json'), packageName: '@test/css' }],
  });

  it('returns documentation for tokens, utilities, components, attributes, values, and slots', () => {
    const cases = [
      ['.x { border-radius: var(--acme-border-radius-2xs); }', 'css', 'acme-border'],
      ['<div class="acme-text-heading-1">', 'html', 'acme-text'],
      ['<acme-button variant="primary">', 'html', 'acme-button'],
      ['<acme-button variant="primary">', 'html', 'variant'],
      ['<acme-button variant="primary">', 'html', 'primary'],
      ['<acme-button><span slot="start">', 'html', 'start'],
    ] as const;
    for (const [text, languageId, needle] of cases) {
      const doc = document(text, languageId);
      const offset = text.indexOf(needle) + 1;
      expect(getHover(doc, doc.positionAt(offset), store)?.contents, needle).toBeTruthy();
    }
  });

  it('shows reference hover content for deprecated tokens alongside diagnostics', () => {
    const text = 'color: var(--acme-color-background-button-primary-pressed)';
    const doc = document(text, 'css');
    expect(getHover(doc, doc.positionAt(text.indexOf('--acme-') + 2), store)?.contents).toEqual(
      expect.objectContaining({ value: expect.stringContaining('### `--acme-color-background-button-primary-pressed`') }),
    );
  });
});

describe('document scanning', () => {
  it('reports exact ranges for mixed HTML, JSX, CSS, and duplicate classes', () => {
    const text = `<acme-button variant="primary" class="utility utility unknown">
  <AcmeButton />
</acme-button>
.x { color: var(--token); }`;
    const symbols = scanDocument(
      document(text),
      new Set(['acme-button']),
      new Set(['--token']),
      new Set(['utility']),
      new Set(['AcmeButton']),
    );

    expect(symbols.map(({ kind, name, start, end }) => ({ kind, name, start, end }))).toEqual([
      { kind: 'tag', name: 'acme-button', start: 1, end: 12 },
      { kind: 'tag', name: 'AcmeButton', start: 67, end: 77 },
      { kind: 'attribute', name: 'variant', start: 13, end: 30 },
      { kind: 'attribute-value', name: 'primary', start: 22, end: 29 },
      { kind: 'attribute', name: 'class', start: 31, end: 62 },
      { kind: 'attribute-value', name: 'utility utility unknown', start: 38, end: 61 },
      { kind: 'css-var', name: '--token', start: 112, end: 119 },
      { kind: 'class', name: 'utility', start: 38, end: 45 },
      { kind: 'class', name: 'utility', start: 46, end: 53 },
    ]);
  });
});

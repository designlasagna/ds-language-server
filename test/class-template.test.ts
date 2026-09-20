import { expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { join } from 'node:path';
import { DSStore } from '../src/store.js';
import { getCursorContext } from '../src/scanner/context.js';
import { scanClassSymbols } from '../src/scanner/classes.js';
import { getCompletions } from '../src/providers/completion.js';
import { tryClassHover } from '../src/providers/hover/class.js';

const store = new DSStore();
store.load({ components: [], tokens: [], utilities: [{ path: join(import.meta.dirname, 'fixtures/utilities.manifest.json'), packageName: '@test/css' }] });

it('provides completions, hover and symbols after a CSS module interpolation', () => {
  const text = '<div className={`${styles.header} acme-text-heading-1`}>';
  const offset = text.indexOf('acme-text-heading-1') + 'acme-text'.length;
  const doc = TextDocument.create('file:///component.tsx', 'typescriptreact', 1, text);
  const context = getCursorContext(doc, offset);
  expect(context).toEqual({ kind: 'class-value', prefix: 'acme-text' });
  expect(getCompletions(context, store).some(item => item.label === 'acme-text-heading-1')).toBe(true);
  expect(tryClassHover(text, offset, store)?.contents).toMatchObject({ value: expect.stringContaining('.acme-text-heading-1') });
  expect(scanClassSymbols(text, new Set(['acme-text-heading-1']))).toEqual([
    { kind: 'class', name: 'acme-text-heading-1', start: text.indexOf('acme-text-heading-1'), end: text.indexOf('acme-text-heading-1') + 19 },
  ]);
  expect(getCursorContext(doc, text.indexOf('styles.header') + 4).kind).not.toBe('class-value');
});

it.each([
  '<div className={`${styles.header} acme-text',
  '<div className={`first ${fn({ value: "}" })} acme-text',
  '<div className={"acme-text',
  "<div className='acme-text",
])('completes incomplete input: %s', text => {
  const doc = TextDocument.create('file:///component.tsx', 'typescriptreact', 1, text);
  expect(getCursorContext(doc, text.length)).toEqual({ kind: 'class-value', prefix: 'acme-text' });
});

it('does not complete inside an unfinished interpolation', () => {
  const text = '<div className={`${styles.header';
  const doc = TextDocument.create('file:///component.tsx', 'typescriptreact', 1, text);
  expect(getCursorContext(doc, text.length).kind).not.toBe('class-value');
});

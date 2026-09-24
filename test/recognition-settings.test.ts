import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { maskRecognizedText, isLanguageEnabled, classAttributes } from '../src/recognition-settings.js';
import { classValueRanges } from '../src/class-values.js';
import { getCursorContext, scanDocument } from '../src/scanner.js';

const doc = (text: string, language = 'typescript') => TextDocument.create('file:///fixture.ts', language, 1, text);

describe('recognition settings', () => {
  it('uses an explicit language allowlist, including an empty list', () => {
    expect(isLanguageEnabled('html')).toBe(true);
    expect(isLanguageEnabled('plaintext')).toBe(false);
    expect(isLanguageEnabled('html', { languages: [] })).toBe(false);
    expect(isLanguageEnabled('custom', { languages: ['custom'] })).toBe(true);
  });
  it('replaces class attribute defaults without merging', () => {
    expect(classAttributes()).toEqual(['class', 'className', 'classList']);
    expect(classAttributes({ classAttributes: ['utility'] })).toEqual(['utility']);
    expect(classAttributes({ classAttributes: [] })).toEqual([]);
  });
  it('keeps source offsets and CRLF inside recognized templates', () => {
    const text = 'const value = html`\r\n<ds-old>`;';
    const masked = maskRecognizedText(text, 'typescript');
    expect(masked.length).toBe(text.length);
    expect(masked.indexOf('<ds-old>')).toBe(text.indexOf('<ds-old>'));
    expect(masked.indexOf('\r\n')).toBe(text.indexOf('\r\n'));
    expect(masked).not.toContain('const');
  });
  it('recognizes default html and css templates only', () => {
    const text = 'html`<ds-old>`; css`var(--old)`; other`<ds-no>`';
    const masked = maskRecognizedText(text, 'typescript');
    expect(masked).toContain('<ds-old>');
    expect(masked).toContain('var(--old)');
    expect(masked).not.toContain('<ds-no>');
  });
  it('replaces template tag lists independently', () => {
    const text = 'ui.html`<ds-new>`; html`<ds-old>`; css`var(--old)`';
    const masked = maskRecognizedText(text, 'typescript', { templateTags: { html: ['ui.html'], css: [] } });
    expect(masked).toContain('<ds-new>');
    expect(masked).not.toContain('<ds-old>');
    expect(masked).not.toContain('var(--old)');
    expect(maskRecognizedText(text, 'typescript', { templateTags: { html: [], css: [] } }).trim()).toBe('');
  });
  it('ignores apparent templates inside comments and ordinary strings', () => {
    const text = '// html`<ds-a>`\n/* html`<ds-b>` */\n"html`<ds-c>`"; \'html`<ds-d>`\'';
    expect(maskRecognizedText(text, 'typescript').trim()).toBe('');
  });
  it('masks interpolation expressions with nested strings, templates and braces', () => {
    const text = 'html`<ds-before>${ fn({ text: "<ds-hidden>", value: `nested ${1}` }) }<ds-after>`';
    const masked = maskRecognizedText(text, 'typescript');
    expect(masked).toContain('<ds-before>');
    expect(masked).toContain('<ds-after>');
    expect(masked).not.toContain('<ds-hidden>');
    expect(masked).not.toContain('nested');
    expect(masked.indexOf('<ds-after>')).toBe(text.indexOf('<ds-after>'));
  });
  it('recognizes nested configured templates without exposing surrounding expressions', () => {
    const text = 'html`<ds-outer>${list.map(x => html`<ds-inner>${x.name}</ds-inner>`)}</ds-outer>`';
    const masked = maskRecognizedText(text, 'typescript');
    expect(masked).toContain('<ds-inner>');
    expect(masked).not.toContain('list.map');
    expect(masked).not.toContain('x.name');
    expect(masked.indexOf('<ds-inner>')).toBe(text.indexOf('<ds-inner>'));
  });
  it('does not let regex braces expose expression strings as markup', () => {
    const text = 'html`<div>${ /}/.test(x) ? "<ds-hidden>" : "" }</div>`';
    const masked = maskRecognizedText(text, 'typescript');
    expect(masked).toContain('</div>');
    expect(masked).not.toContain('<ds-hidden>');
    expect(maskRecognizedText('const pattern = /html`<ds-hidden>`/;', 'typescript').trim()).toBe('');
  });
  it('supports unterminated templates while editing', () => {
    const text = 'html`<ds-';
    expect(getCursorContext(doc(text), text.length)).toMatchObject({ kind: 'tag-open', prefix: 'ds-' });
  });
  it('escapes configured attributes and enforces boundaries', () => {
    const text = '<div data.classes="old-util" data-class="other">';
    const ranges = classValueRanges(text, ['data.classes']);
    expect(ranges.map(r => text.slice(r.start, r.end))).toEqual(['old-util']);
    expect(classValueRanges(text)).toEqual([]);
    expect(classValueRanges(text, [])).toEqual([]);
  });
  it('applies custom attributes consistently to scanning and completion', () => {
    const text = '<div utility="old-util" class="old-util">';
    const config = { classAttributes: ['utility'] };
    const document = doc(text, 'html');
    const symbols = scanDocument(document, new Set(), new Set(), new Set(['old-util']), undefined, config);
    expect(symbols.filter(s => s.kind === 'class').map(s => s.start)).toEqual([text.indexOf('old-util')]);
    expect(getCursorContext(document, text.indexOf('old-util') + 4, config)).toMatchObject({ kind: 'class-value', prefix: 'old-' });
    expect(getCursorContext(document, text.lastIndexOf('old-util') + 4, config).kind).not.toBe('class-value');
  });
  it('gates scans and completion for excluded languages', () => {
    const text = '<ds-old class="old-util">';
    const document = doc(text, 'html');
    expect(scanDocument(document, new Set(['ds-old']), new Set(), new Set(['old-util']), undefined, { languages: [] })).toEqual([]);
    expect(getCursorContext(document, 5, { languages: [] }).kind).toBe('none');
  });
  it('recognizes configured tags through the production scanner', () => {
    const text = 'view`<ds-old>`; html`<ds-old>`; "<ds-old>";';
    const symbols = scanDocument(doc(text), new Set(['ds-old']), new Set(), new Set(), undefined, { templateTags: { html: ['view'] } });
    expect(symbols.filter(s => s.kind === 'tag')).toHaveLength(1);
    expect(symbols[0].start).toBe(text.indexOf('ds-old'));
  });
});

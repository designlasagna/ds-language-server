import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseCEM } from '../src/parsers/cem.js';
import { parseTokens } from '../src/parsers/tokens.js';
import { parseUtilities } from '../src/parsers/utilities.js';
import { DSStore } from '../src/store.js';
import { getCursorContext } from '../src/scanner.js';
import { getCompletions } from '../src/providers/completion.js';
import { getHover } from '../src/providers/hover.js';
import { getDiagnostics } from '../src/providers/diagnostics.js';
import { getCodeActions } from '../src/providers/code-actions.js';
import {
  daysUntilRemoval,
  formatRemovalDate,
  getDeprecationSeverity,
  isDeprecated,
} from '../src/lifecycle.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver';

const fixturesDir = path.join(import.meta.dirname, 'fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8'));
}

function createDoc(content: string, languageId = 'html'): TextDocument {
  return TextDocument.create('file:///test.html', languageId, 1, content);
}

// DTCG lifecycle dates are date-only UTC strings. Noon avoids crossing a UTC
// date boundary when this test happens to run shortly after local midnight.
function relativeUtcDate(days: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0]!;
}

// ─── Lifecycle Tests ───────────────────────────────────────────────

describe('lifecycle', () => {
  it('calculates days until removal', () => {
    expect(daysUntilRemoval(relativeUtcDate(30))).toBe(30);
  });

  it('returns negative for past dates', () => {
    expect(daysUntilRemoval(relativeUtcDate(-10))).toBe(-10);
  });

  it('returns undefined for invalid dates', () => {
    expect(daysUntilRemoval(undefined)).toBeUndefined();
    expect(daysUntilRemoval('not-a-date')).toBeUndefined();
  });

  it('formats removal date with human-readable suffix', () => {
    expect(formatRemovalDate(relativeUtcDate(5))).toContain('in 5 days');
  });

  it('severity escalates with proximity', () => {
    const far = new Date();
    far.setDate(far.getDate() + 120);
    expect(getDeprecationSeverity(far.toISOString().split('T')[0])).toBe(
      DiagnosticSeverity.Information,
    );

    const mid = new Date();
    mid.setDate(mid.getDate() + 60);
    expect(getDeprecationSeverity(mid.toISOString().split('T')[0])).toBe(
      DiagnosticSeverity.Warning,
    );

    const close = new Date();
    close.setDate(close.getDate() + 10);
    expect(getDeprecationSeverity(close.toISOString().split('T')[0])).toBe(
      DiagnosticSeverity.Error,
    );

    const past = new Date();
    past.setDate(past.getDate() - 5);
    expect(getDeprecationSeverity(past.toISOString().split('T')[0])).toBe(
      DiagnosticSeverity.Error,
    );
  });

  it('respects severity overrides', () => {
    expect(getDeprecationSeverity(undefined, 'off')).toBeUndefined();
    expect(getDeprecationSeverity(undefined, 'error')).toBe(DiagnosticSeverity.Error);
  });

  it('detects deprecated from boolean or status', () => {
    expect(isDeprecated({ deprecated: true })).toBe(true);
    expect(isDeprecated({ deprecated: false })).toBe(false);
    expect(isDeprecated({ status: 'deprecated' })).toBe(true);
    expect(isDeprecated({ status: 'ready' })).toBe(false);
    expect(isDeprecated({})).toBe(false);
  });
});

// ─── CEM Parser Tests ──────────────────────────────────────────────

describe('CEM parser', () => {
  let components: ReturnType<typeof parseCEM>;

  beforeAll(() => {
    const cem = loadFixture('custom-elements.json');
    components = parseCEM(cem, '@test/components');
  });

  it('parses components from CEM', () => {
    expect(components.length).toBeGreaterThanOrEqual(1);
    const button = components.find((c) => c.tagName === 'acme-button');
    expect(button).toBeDefined();
  });

  it('extracts attributes with types', () => {
    const button = components.find((c) => c.tagName === 'acme-button')!;
    const variant = button.attributes.find((a) => a.htmlName === 'variant');
    expect(variant).toBeDefined();
    expect(variant!.type).toBe('string');
  });

  it('detects deprecated attributes', () => {
    const button = components.find((c) => c.tagName === 'acme-button')!;
    const label = button.attributes.find((a) => a.htmlName === 'label');
    expect(label).toBeDefined();
    expect(label!.deprecated).toBe(true);
    expect(label!.deprecationMessage).toContain('slot');
  });

  it('detects deprecated values from message + enum', () => {
    const button = components.find((c) => c.tagName === 'acme-button')!;
    const variant = button.attributes.find((a) => a.htmlName === 'variant');
    expect(variant).toBeDefined();
    expect(variant!.deprecatedValues).toBeDefined();
    expect(variant!.deprecatedValues!.length).toBeGreaterThan(0);

    const tertiary = variant!.deprecatedValues!.find((dv) => dv.value === 'tertiary');
    expect(tertiary).toBeDefined();
    expect(tertiary!.replacement).toBe('secondary');
  });

  it('extracts removal dates', () => {
    const button = components.find((c) => c.tagName === 'acme-button')!;
    const variant = button.attributes.find((a) => a.htmlName === 'variant');
    // variant itself is NOT deprecated — only specific values are
    expect(variant!.deprecated).toBe(false);
    expect(variant!.removal).toBeUndefined();
    // The removal date lives on the deprecated values
    const tertiary = variant!.deprecatedValues?.find((v) => v.value === 'tertiary');
    expect(tertiary!.removal).toBe('2026-07-30');

    // The label attribute IS deprecated (the whole attribute, not just a value)
    const label = button.attributes.find((a) => a.htmlName === 'label');
    expect(label!.deprecated).toBe(true);
    expect(label!.removal).toBe('2026-07-30');
  });

  it('extracts component status', () => {
    const button = components.find((c) => c.tagName === 'acme-button');
    expect(button!.status).toBe('ready');

    const shortcut = components.find((c) => c.tagName === 'acme-shortcut');
    expect(shortcut!.status).toBe('draft');
  });

  it('extracts slots', () => {
    const button = components.find((c) => c.tagName === 'acme-button')!;
    expect(button.slots.length).toBeGreaterThan(0);
    expect(button.slots.some((s) => s.name === 'default')).toBe(true);
  });
});

// ─── Token Parser Tests ────────────────────────────────────────────

describe('Token parser', () => {
  let tokens: ReturnType<typeof parseTokens>;

  beforeAll(() => {
    const data = loadFixture('tokens.json');
    tokens = parseTokens(data, '@test/tokens');
  });

  it('parses tokens from Acme format', () => {
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('extracts CSS variable names', () => {
    const spacing = tokens.find((t) => t.name.includes('radius'));
    expect(spacing).toBeDefined();
    expect(spacing!.name).toMatch(/^--/);
  });

  it('resolves values', () => {
    const token = tokens.find((t) => t.value);
    expect(token).toBeDefined();
    expect(token!.value).toBeTruthy();
  });

  it('detects deprecated tokens', () => {
    const deprecated = tokens.find((t) => t.deprecated);
    expect(deprecated).toBeDefined();
    expect(deprecated!.name).toBe('--acme-color-background-button-primary-pressed');
    expect(deprecated!.deprecationMessage).toContain('interactive');
    expect(deprecated!.removal).toBe('2026-07-30');
    expect(deprecated!.replacement).toBe('--acme-color-interactive-primary-pressed');
  });

  it('extracts group and category', () => {
    const token = tokens[0];
    expect(token.group).toBeTruthy();
  });
});

// ─── Utility Parser Tests ──────────────────────────────────────────

describe('Utility parser', () => {
  let utilities: ReturnType<typeof parseUtilities>;

  beforeAll(() => {
    const data = loadFixture('utilities.manifest.json');
    utilities = parseUtilities(data, '@test/css');
  });

  it('parses utilities from categorized format', () => {
    expect(utilities.length).toBeGreaterThan(0);
  });

  it('extracts class names and descriptions', () => {
    const heading = utilities.find((u) => u.name === 'acme-text-heading-1');
    expect(heading).toBeDefined();
    expect(heading!.description).toContain('heading');
  });

  it('assigns category from parent', () => {
    const heading = utilities.find((u) => u.name === 'acme-text-heading-1');
    expect(heading!.category).toBe('Text Style – Heading');
  });

  it('parses all expected classes', () => {
    const names = utilities.map((u) => u.name);
    expect(names).toContain('acme-sr-only');
    expect(names).toContain('acme-text-body-default');
    expect(names).toContain('acme-font-bold');
  });
});

// ─── Store Tests ───────────────────────────────────────────────────

describe('DSStore', () => {
  let store: DSStore;

  beforeAll(() => {
    store = new DSStore();

    const cemData = loadFixture('custom-elements.json');
    const tokenData = loadFixture('tokens.json');
    const utilityData = loadFixture('utilities.manifest.json');

    // Manually load using parsers
    const components = parseCEM(cemData, '@test/components');
    const tokens = parseTokens(tokenData, '@test/tokens');
    const utilities = parseUtilities(utilityData, '@test/css');

    // Use load() with ManifestSources
    store.load({
      components: [{ path: path.join(fixturesDir, 'custom-elements.json'), packageName: '@test/components' }],
      tokens: [{ path: path.join(fixturesDir, 'tokens.json'), packageName: '@test/tokens' }],
      utilities: [{ path: path.join(fixturesDir, 'utilities.manifest.json'), packageName: '@test/css' }],
    });
  });

  it('loads all data types', () => {
    const stats = store.stats();
    expect(stats.components).toBeGreaterThan(0);
    expect(stats.tokens).toBeGreaterThan(0);
    expect(stats.utilities).toBeGreaterThan(0);
  });

  it('looks up components by tag name', () => {
    expect(store.getComponent('acme-button')).toBeDefined();
    expect(store.getComponent('nonexistent')).toBeUndefined();
  });

  it('looks up tokens by name', () => {
    const token = store.getToken('--acme-color-background-button-primary-pressed');
    expect(token).toBeDefined();
    expect(token!.deprecated).toBe(true);
  });

  it('looks up utilities by name', () => {
    expect(store.getUtility('acme-text-heading-1')).toBeDefined();
  });
});

// ─── Scanner Tests ─────────────────────────────────────────────────

describe('Scanner: getCursorContext', () => {
  it('detects tag-open context', () => {
    const doc = createDoc('<acme-');
    const ctx = getCursorContext(doc, 6);
    expect(ctx.kind).toBe('tag-open');
    expect(ctx.prefix).toBe('acme-');
  });

  it('detects attribute-name context', () => {
    const doc = createDoc('<acme-button var');
    const ctx = getCursorContext(doc, 16);
    expect(ctx.kind).toBe('attribute-name');
    expect(ctx.tagName).toBe('acme-button');
    expect(ctx.prefix).toBe('var');
  });

  it('detects attribute-value context', () => {
    const doc = createDoc('<acme-button variant="pri');
    const ctx = getCursorContext(doc, 25); // cursor after 'pri'
    expect(ctx.kind).toBe('attribute-value');
    expect(ctx.tagName).toBe('acme-button');
    expect(ctx.attributeName).toBe('variant');
    expect(ctx.prefix).toBe('pri');
  });

  it('detects css-var context', () => {
    const doc = createDoc('color: var(--acme-', 'css');
    const ctx = getCursorContext(doc, 18);
    expect(ctx.kind).toBe('css-var');
    expect(ctx.prefix).toBe('--acme-');
  });

  it('detects class-value context', () => {
    const doc = createDoc('<div class="acme-text-');
    const ctx = getCursorContext(doc, doc.getText().length);
    expect(ctx.kind).toBe('class-value');
    expect(ctx.prefix).toBe('acme-text-');
  });
});

// ─── Completion Provider Tests ─────────────────────────────────────

describe('Completion provider', () => {
  let store: DSStore;

  beforeAll(() => {
    store = new DSStore();
    store.load({
      components: [{ path: path.join(fixturesDir, 'custom-elements.json'), packageName: '@test/components' }],
      tokens: [{ path: path.join(fixturesDir, 'tokens.json'), packageName: '@test/tokens' }],
      utilities: [{ path: path.join(fixturesDir, 'utilities.manifest.json'), packageName: '@test/css' }],
    });
  });

  it('completes component tags', () => {
    const items = getCompletions({ kind: 'tag-open', prefix: 'acme-' }, store);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.label === 'acme-button')).toBe(true);
  });

  it('uses text-only lifecycle presentation while preserving deprecation tags', () => {
    const tagItems = getCompletions({ kind: 'tag-open', prefix: 'acme-shortcut' }, store);
    const shortcut = tagItems.find((item) => item.label === 'acme-shortcut');
    expect(shortcut?.detail).toBe('Custom Element — draft');
    expect(JSON.stringify(tagItems)).not.toMatch(/[\p{Extended_Pictographic}]/u);

    const deprecatedTokens = getCompletions(
      { kind: 'css-var', prefix: '--acme-color-background-button' },
      store,
    );
    const deprecated = deprecatedTokens.find((item) => item.label.includes('pressed'));
    expect(deprecated?.tags).toContain(1); // CompletionItemTag.Deprecated = 1
    expect(JSON.stringify(deprecated)).toContain('**Deprecated**');
    expect(JSON.stringify(deprecated)).not.toMatch(/[\p{Extended_Pictographic}]/u);

    const document = createDoc('<acme-shortcut></acme-shortcut>');
    const hover = getHover(document, { line: 0, character: 5 }, store);
    expect(hover?.contents).toEqual(expect.objectContaining({
      value: expect.stringContaining('**Status:** draft'),
    }));
    expect(JSON.stringify(hover)).not.toMatch(/[\p{Extended_Pictographic}]/u);
  });

  it('completes component attributes', () => {
    const items = getCompletions(
      { kind: 'attribute-name', prefix: '', tagName: 'acme-button' },
      store,
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.label === 'variant')).toBe(true);
  });

  it('marks deprecated attributes with strikethrough', () => {
    const items = getCompletions(
      { kind: 'attribute-name', prefix: '', tagName: 'acme-button' },
      store,
    );
    const label = items.find((i) => i.label === 'label');
    expect(label).toBeDefined();
    expect(label!.tags).toContain(1); // CompletionItemTag.Deprecated = 1
  });

  it('completes attribute values with deprecated values marked', () => {
    const items = getCompletions(
      { kind: 'attribute-value', prefix: '', tagName: 'acme-button', attributeName: 'variant' },
      store,
    );
    expect(items.length).toBeGreaterThan(0);

    const tertiary = items.find((i) => i.label === 'tertiary');
    expect(tertiary).toBeDefined();
    expect(tertiary!.tags).toContain(1);
  });

  it('completes CSS variables', () => {
    const items = getCompletions({ kind: 'css-var', prefix: '--acme-' }, store);
    expect(items.length).toBeGreaterThan(0);
  });

  it('marks deprecated tokens with strikethrough', () => {
    const items = getCompletions({ kind: 'css-var', prefix: '--acme-color-background-button' }, store);
    const deprecated = items.find((i) => i.label.includes('pressed'));
    expect(deprecated).toBeDefined();
    expect(deprecated!.tags).toContain(1);
  });

  it('completes utility classes', () => {
    const items = getCompletions({ kind: 'class-value', prefix: 'acme-text-' }, store);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.label === 'acme-text-heading-1')).toBe(true);
  });

  it('completes slot values from parent component', () => {
    const items = getCompletions(
      { kind: 'attribute-value', prefix: '', tagName: 'span', attributeName: 'slot', parentTagName: 'acme-button' },
      store,
    );
    expect(items.length).toBe(2);
    expect(items.some((i) => i.label === 'start')).toBe(true);
    expect(items.some((i) => i.label === 'end')).toBe(true);
  });

  it('offers slot attribute when inside a parent component', () => {
    const items = getCompletions(
      { kind: 'attribute-name', prefix: '', tagName: 'span', parentTagName: 'acme-button' },
      store,
    );
    const slotItem = items.find((i) => i.label === 'slot');
    expect(slotItem).toBeDefined();
    expect(slotItem!.detail).toContain('start');
    expect(slotItem!.detail).toContain('end');
  });

  it('does not offer slot attribute without parent component', () => {
    const items = getCompletions(
      { kind: 'attribute-name', prefix: '', tagName: 'span' },
      store,
    );
    const slotItem = items.find((i) => i.label === 'slot');
    expect(slotItem).toBeUndefined();
  });
});

// ─── Hover Provider Tests ──────────────────────────────────────────

describe('deprecated hover presentation', () => {
  let store: DSStore;

  beforeAll(() => {
    store = new DSStore();
    store.load({
      components: [{ path: path.join(fixturesDir, 'custom-elements.json'), packageName: '@test/components' }],
      tokens: [{ path: path.join(fixturesDir, 'tokens.json'), packageName: '@test/tokens' }],
      utilities: [{ path: path.join(fixturesDir, 'utilities.manifest.json'), packageName: '@test/css' }],
    });

    const utility = store.getUtility('acme-text-heading-1')!;
    utility.deprecated = true;
    utility.deprecationMessage = 'Use acme-text-body-default instead.';
    utility.replacement = 'acme-text-body-default';
    utility.removal = '2026-12-31';
  });

  function markdownAt(content: string, needle: string): string {
    const document = createDoc(content);
    const hover = getHover(document, document.positionAt(content.indexOf(needle) + 1), store);
    expect(hover?.contents).toEqual(expect.objectContaining({ value: expect.any(String) }));
    return (hover!.contents as { value: string }).value;
  }

  it('shows a callout for a deprecated token', () => {
    const markdown = markdownAt('a { color: var(--acme-color-background-button-primary-pressed); }', 'pressed');
    expect(markdown).toContain('**Deprecated**');
    expect(markdown).toContain('**Replacement:**');
    expect(markdown).toContain('### `--acme-color-background-button-primary-pressed`');
  });

  it('shows a callout for a deprecated utility', () => {
    const markdown = markdownAt('<div class="acme-text-heading-1"></div>', 'heading-1');
    expect(markdown).toContain('**Deprecated**');
    expect(markdown).toContain('**Replacement:** `acme-text-body-default`');
    expect(markdown).toContain('### `.acme-text-heading-1`');
  });

  it('shows a callout for a deprecated attribute', () => {
    const markdown = markdownAt('<acme-button label="Old"></acme-button>', 'label');
    expect(markdown).toContain('**Deprecated**');
    expect(markdown).toContain('Use `default` slot instead');
    expect(markdown).toContain('### `label`');
  });

  it('shows a callout for a deprecated attribute value', () => {
    const markdown = markdownAt('<acme-button variant="tertiary"></acme-button>', 'tertiary');
    expect(markdown).toContain('**Deprecated**');
    expect(markdown).toContain('Use `secondary` instead');
    expect(markdown).toContain('### `variant="tertiary"`');
  });
});

// ─── Diagnostics Tests ─────────────────────────────────────────────

describe('Diagnostics', () => {
  let store: DSStore;

  beforeAll(() => {
    store = new DSStore();
    store.load({
      components: [{ path: path.join(fixturesDir, 'custom-elements.json'), packageName: '@test/components' }],
      tokens: [{ path: path.join(fixturesDir, 'tokens.json'), packageName: '@test/tokens' }],
      utilities: [{ path: path.join(fixturesDir, 'utilities.manifest.json'), packageName: '@test/css' }],
    });
  });

  it('diagnoses deprecated token usage', () => {
    const doc = createDoc(
      '.btn { color: var(--acme-color-background-button-primary-pressed); }',
      'css',
    );
    const diagnostics = getDiagnostics(doc, store);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain('scheduled for removal');
    expect(diagnostics[0].message).toContain('--acme-color-interactive-primary-pressed');
  });

  it('diagnoses deprecated attribute values', () => {
    const doc = createDoc('<acme-button variant="tertiary">Click</acme-button>');
    const diagnostics = getDiagnostics(doc, store);
    const valueDiag = diagnostics.find((d) =>
      d.message.includes('tertiary'),
    );
    expect(valueDiag).toBeDefined();
  });

  it('diagnoses draft component usage', () => {
    const doc = createDoc('<acme-shortcut label="test"></acme-shortcut>');
    const diagnostics = getDiagnostics(doc, store);
    const draftDiag = diagnostics.find((d) => d.message.includes('draft'));
    expect(draftDiag).toBeDefined();
  });

  it('provides code actions for replaceable values', () => {
    const doc = createDoc('<acme-button variant="tertiary">Click</acme-button>');
    const diagnostics = getDiagnostics(doc, store);
    const valueDiag = diagnostics.filter((d) =>
      d.data && (d.data as { replacement?: string }).replacement,
    );
    if (valueDiag.length > 0) {
      const actions = getCodeActions(doc, valueDiag);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0].title).toContain('secondary');
    }
  });
});

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

// ─── Lifecycle Tests ───────────────────────────────────────────────

describe('lifecycle', () => {
  it('calculates days until removal', () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const dateStr = future.toISOString().split('T')[0];
    expect(daysUntilRemoval(dateStr)).toBe(30);
  });

  it('returns negative for past dates', () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    const dateStr = past.toISOString().split('T')[0];
    expect(daysUntilRemoval(dateStr)).toBe(-10);
  });

  it('returns undefined for invalid dates', () => {
    expect(daysUntilRemoval(undefined)).toBeUndefined();
    expect(daysUntilRemoval('not-a-date')).toBeUndefined();
  });

  it('formats removal date with human-readable suffix', () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const dateStr = future.toISOString().split('T')[0];
    expect(formatRemovalDate(dateStr)).toContain('in 5 days');
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
    const button = components.find((c) => c.tagName === 'lfds-button');
    expect(button).toBeDefined();
  });

  it('extracts attributes with types', () => {
    const button = components.find((c) => c.tagName === 'lfds-button')!;
    const variant = button.attributes.find((a) => a.htmlName === 'variant');
    expect(variant).toBeDefined();
    expect(variant!.type).toBe('string');
  });

  it('detects deprecated attributes', () => {
    const button = components.find((c) => c.tagName === 'lfds-button')!;
    const label = button.attributes.find((a) => a.htmlName === 'label');
    expect(label).toBeDefined();
    expect(label!.deprecated).toBe(true);
    expect(label!.deprecationMessage).toContain('slot');
  });

  it('detects deprecated values from message + enum', () => {
    const button = components.find((c) => c.tagName === 'lfds-button')!;
    const variant = button.attributes.find((a) => a.htmlName === 'variant');
    expect(variant).toBeDefined();
    expect(variant!.deprecatedValues).toBeDefined();
    expect(variant!.deprecatedValues!.length).toBeGreaterThan(0);

    const tertiary = variant!.deprecatedValues!.find((dv) => dv.value === 'tertiary');
    expect(tertiary).toBeDefined();
    expect(tertiary!.replacement).toBe('secondary');
  });

  it('extracts removal dates', () => {
    const button = components.find((c) => c.tagName === 'lfds-button')!;
    const variant = button.attributes.find((a) => a.htmlName === 'variant');
    expect(variant!.removal).toBe('2026-07-30');
  });

  it('extracts component status', () => {
    const button = components.find((c) => c.tagName === 'lfds-button');
    expect(button!.status).toBe('ready');

    const shortcut = components.find((c) => c.tagName === 'lfds-shortcut');
    expect(shortcut!.status).toBe('draft');
  });

  it('extracts slots', () => {
    const button = components.find((c) => c.tagName === 'lfds-button')!;
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

  it('parses tokens from LFDS format', () => {
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
    expect(deprecated!.name).toBe('--lfds-color-background-button-primary-pressed');
    expect(deprecated!.deprecationMessage).toContain('interactive');
    expect(deprecated!.removal).toBe('2026-07-30');
    expect(deprecated!.replacement).toBe('--lfds-color-interactive-primary-pressed');
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
    const heading = utilities.find((u) => u.name === 'lf-text-heading-1');
    expect(heading).toBeDefined();
    expect(heading!.description).toContain('heading');
  });

  it('assigns category from parent', () => {
    const heading = utilities.find((u) => u.name === 'lf-text-heading-1');
    expect(heading!.category).toBe('Text Style – Heading');
  });

  it('parses all expected classes', () => {
    const names = utilities.map((u) => u.name);
    expect(names).toContain('lf-sr-only');
    expect(names).toContain('lf-text-body-default');
    expect(names).toContain('lf-font-bold');
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
    expect(store.getComponent('lfds-button')).toBeDefined();
    expect(store.getComponent('nonexistent')).toBeUndefined();
  });

  it('looks up tokens by name', () => {
    const token = store.getToken('--lfds-color-background-button-primary-pressed');
    expect(token).toBeDefined();
    expect(token!.deprecated).toBe(true);
  });

  it('looks up utilities by name', () => {
    expect(store.getUtility('lf-text-heading-1')).toBeDefined();
  });
});

// ─── Scanner Tests ─────────────────────────────────────────────────

describe('Scanner: getCursorContext', () => {
  it('detects tag-open context', () => {
    const doc = createDoc('<lfds-');
    const ctx = getCursorContext(doc, 6);
    expect(ctx.kind).toBe('tag-open');
    expect(ctx.prefix).toBe('lfds-');
  });

  it('detects attribute-name context', () => {
    const doc = createDoc('<lfds-button var');
    const ctx = getCursorContext(doc, 16);
    expect(ctx.kind).toBe('attribute-name');
    expect(ctx.tagName).toBe('lfds-button');
    expect(ctx.prefix).toBe('var');
  });

  it('detects attribute-value context', () => {
    const doc = createDoc('<lfds-button variant="pri');
    const ctx = getCursorContext(doc, 25); // cursor after 'pri'
    expect(ctx.kind).toBe('attribute-value');
    expect(ctx.tagName).toBe('lfds-button');
    expect(ctx.attributeName).toBe('variant');
    expect(ctx.prefix).toBe('pri');
  });

  it('detects css-var context', () => {
    const doc = createDoc('color: var(--lfds-', 'css');
    const ctx = getCursorContext(doc, 18);
    expect(ctx.kind).toBe('css-var');
    expect(ctx.prefix).toBe('--lfds-');
  });

  it('detects class-value context', () => {
    const doc = createDoc('<div class="lf-text-');
    const ctx = getCursorContext(doc, 20);
    expect(ctx.kind).toBe('class-value');
    expect(ctx.prefix).toBe('lf-text-');
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
    const items = getCompletions({ kind: 'tag-open', prefix: 'lfds-' }, store);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.label === 'lfds-button')).toBe(true);
  });

  it('completes component attributes', () => {
    const items = getCompletions(
      { kind: 'attribute-name', prefix: '', tagName: 'lfds-button' },
      store,
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.label === 'variant')).toBe(true);
  });

  it('marks deprecated attributes with strikethrough', () => {
    const items = getCompletions(
      { kind: 'attribute-name', prefix: '', tagName: 'lfds-button' },
      store,
    );
    const label = items.find((i) => i.label === 'label');
    expect(label).toBeDefined();
    expect(label!.tags).toContain(1); // CompletionItemTag.Deprecated = 1
  });

  it('completes attribute values with deprecated values marked', () => {
    const items = getCompletions(
      { kind: 'attribute-value', prefix: '', tagName: 'lfds-button', attributeName: 'variant' },
      store,
    );
    expect(items.length).toBeGreaterThan(0);

    const tertiary = items.find((i) => i.label === 'tertiary');
    expect(tertiary).toBeDefined();
    expect(tertiary!.tags).toContain(1);
  });

  it('completes CSS variables', () => {
    const items = getCompletions({ kind: 'css-var', prefix: '--lfds-' }, store);
    expect(items.length).toBeGreaterThan(0);
  });

  it('marks deprecated tokens with strikethrough', () => {
    const items = getCompletions({ kind: 'css-var', prefix: '--lfds-color-background-button' }, store);
    const deprecated = items.find((i) => i.label.includes('pressed'));
    expect(deprecated).toBeDefined();
    expect(deprecated!.tags).toContain(1);
  });

  it('completes utility classes', () => {
    const items = getCompletions({ kind: 'class-value', prefix: 'lf-text-' }, store);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.label === 'lf-text-heading-1')).toBe(true);
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
      '.btn { color: var(--lfds-color-background-button-primary-pressed); }',
      'css',
    );
    const diagnostics = getDiagnostics(doc, store);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain('deprecated');
  });

  it('diagnoses deprecated attribute values', () => {
    const doc = createDoc('<lfds-button variant="tertiary">Click</lfds-button>');
    const diagnostics = getDiagnostics(doc, store);
    const valueDiag = diagnostics.find((d) =>
      d.message.includes('tertiary'),
    );
    expect(valueDiag).toBeDefined();
  });

  it('diagnoses draft component usage', () => {
    const doc = createDoc('<lfds-shortcut label="test"></lfds-shortcut>');
    const diagnostics = getDiagnostics(doc, store);
    const draftDiag = diagnostics.find((d) => d.message.includes('draft'));
    expect(draftDiag).toBeDefined();
  });

  it('provides code actions for replaceable values', () => {
    const doc = createDoc('<lfds-button variant="tertiary">Click</lfds-button>');
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

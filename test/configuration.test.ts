import { describe, expect, it } from 'vitest';
import { resolveConfiguration, type EditorRecognitionSettings } from '../src/configuration.js';
import type { DSConfig } from '../src/types.js';

const fileConfig: DSConfig = {
  sources: {
    components: ['node_modules/@acme/ds/custom-elements.json'],
    tokens: ['tokens.json'],
    utilities: ['utilities.manifest.json'],
  },
  discovery: { enabled: false, packages: ['@acme/ds'] },
  lifecycle: { profile: '0.4' },
  diagnostics: {
    deprecated: 'information',
    draftUsage: 'warning',
    packages: {
      '@acme/ds': { deprecated: 'error' },
      '@acme/other': { deprecated: 'off' },
    },
  },
  languages: ['html'],
  templateTags: { html: ['acme-card'], css: ['.acme-utility'] },
  classAttributes: ['className'],
};

describe('precedence', () => {
  it('returns an empty config when neither source is provided', () => {
    expect(resolveConfiguration(undefined, undefined)).toEqual({});
    expect(resolveConfiguration(undefined, {})).toEqual({});
  });

  it('leaves file config untouched when no editor settings are supplied (no defaults injected)', () => {
    expect(resolveConfiguration(fileConfig, undefined)).toEqual(fileConfig);
    // Absent fields stay absent: consumers keep their built-in defaults.
    expect(resolveConfiguration({ lifecycle: { profile: '0.4' } }, undefined)).toEqual({
      lifecycle: { profile: '0.4' },
    });
  });

  it('lets editor settings override file config on allowed fields only', () => {
    const editor: EditorRecognitionSettings = {
      languages: ['html', 'css'],
      templateTags: { html: ['card'] },
      classAttributes: ['class'],
      diagnostics: { deprecated: 'error' },
    };
    const result = resolveConfiguration(fileConfig, editor);
    expect(result.languages).toEqual(['html', 'css']);
    expect(result.templateTags).toEqual({ html: ['card'], css: ['.acme-utility'] });
    expect(result.classAttributes).toEqual(['class']);
    expect(result.diagnostics?.deprecated).toBe('error');
    // File-only fields survive untouched.
    expect(result.sources).toEqual(fileConfig.sources);
    expect(result.discovery).toEqual(fileConfig.discovery);
    expect(result.lifecycle).toEqual(fileConfig.lifecycle);
    expect(result.diagnostics?.draftUsage).toBe('warning');
  });

  it('never applies editor values to file-only fields (no implicit sources override)', () => {
    const editor = {
      sources: { components: ['editor-supplied.json'] },
      discovery: { enabled: true, packages: [] },
      lifecycle: { profile: '0.4' },
      diagnostics: { draftUsage: 'off' },
    };
    expect(resolveConfiguration(fileConfig, editor)).toEqual(fileConfig);
  });

  it('resets the editor layer when given a fresh empty settings object', () => {
    const withOverlay = resolveConfiguration(fileConfig, { languages: ['css'], classAttributes: ['class'] });
    expect(withOverlay.languages).toEqual(['css']);

    const reset = resolveConfiguration(fileConfig, {});
    expect(reset).toEqual(fileConfig);
    expect(reset.languages).toEqual(['html']);
    expect(reset.classAttributes).toEqual(['className']);
  });
});

describe('editor overlay fields', () => {
  it('replaces languages and classAttributes wholesale, including an explicit []', () => {
    expect(resolveConfiguration(fileConfig, { languages: ['css'] }).languages).toEqual(['css']);
    expect(resolveConfiguration(fileConfig, { languages: [] }).languages).toEqual([]);
    expect(resolveConfiguration(fileConfig, { classAttributes: [] }).classAttributes).toEqual([]);
  });

  it('keeps file values when the editor field is absent or undefined', () => {
    expect(resolveConfiguration(fileConfig, { classAttributes: undefined }).languages).toEqual(['html']);
    expect(resolveConfiguration(fileConfig, {}).templateTags).toEqual(fileConfig.templateTags);
  });

  it('merges templateTags per field', () => {
    expect(
      resolveConfiguration(fileConfig, { templateTags: { html: ['card'] } }).templateTags,
    ).toEqual({ html: ['card'], css: ['.acme-utility'] });
    expect(
      resolveConfiguration(fileConfig, { templateTags: { css: ['.u'] } }).templateTags,
    ).toEqual({ html: ['acme-card'], css: ['.u'] });
    expect(
      resolveConfiguration(fileConfig, { templateTags: { html: [], css: [] } }).templateTags,
    ).toEqual({ html: [], css: [] });
    // Adding templateTags where the file has none does not touch other fields.
    expect(
      resolveConfiguration({ languages: ['html'] }, { templateTags: { html: ['card'] } }),
    ).toEqual({ languages: ['html'], templateTags: { html: ['card'] } });
  });

  it('overrides diagnostics.deprecated without touching sibling diagnostics fields', () => {
    const result = resolveConfiguration(fileConfig, { diagnostics: { deprecated: 'off' } });
    expect(result.diagnostics?.deprecated).toBe('off');
    expect(result.diagnostics?.draftUsage).toBe('warning');
    expect(result.diagnostics?.packages).toEqual(fileConfig.diagnostics?.packages);
  });

  it('merges diagnostics.packages per package (update, keep, and add)', () => {
    const editor: EditorRecognitionSettings = {
      diagnostics: {
        packages: {
          '@acme/ds': { deprecated: 'off' },
          '@acme/new': { deprecated: 'warning' },
        },
      },
    };
    const result = resolveConfiguration(fileConfig, editor);
    expect(result.diagnostics?.packages).toEqual({
      '@acme/ds': { deprecated: 'off' },
      '@acme/other': { deprecated: 'off' },
      '@acme/new': { deprecated: 'warning' },
    });
  });

  it('ignores invalid package entries instead of crashing or clearing file values', () => {
    const editor = {
      diagnostics: {
        packages: {
          '@acme/ds': { deprecated: 'not-a-severity' },
          '@acme/other': 42,
          '@acme/new': { deprecated: 'error' },
        },
      },
    };
    const result = resolveConfiguration(fileConfig, editor);
    expect(result.diagnostics?.packages).toEqual({
      '@acme/ds': { deprecated: 'error' },
      '@acme/other': { deprecated: 'off' },
      '@acme/new': { deprecated: 'error' },
    });
  });

  it('keeps prototype-named packages as own data entries', () => {
    const file = JSON.parse('{"diagnostics":{"packages":{"__proto__":{"deprecated":"warning"},"constructor":{"deprecated":"off"}}}}') as DSConfig;
    const editor = JSON.parse('{"diagnostics":{"packages":{"__proto__":{"deprecated":"error"}}}}');
    const packages = resolveConfiguration(file, editor).diagnostics?.packages!;

    expect(Object.getPrototypeOf(packages)).toBe(Object.prototype);
    expect(Object.hasOwn(packages, '__proto__')).toBe(true);
    expect(Object.hasOwn(packages, 'constructor')).toBe(true);
    expect(packages['__proto__'].deprecated).toBe('error');
    expect(packages.constructor.deprecated).toBe('off');
  });
});

describe('invalid editor settings are ignored', () => {
  const invalidTopLevel: unknown[] = [null, undefined, 0, 1, 'settings', true, NaN, [1, 2], ['html']];

  it.each(invalidTopLevel)('survives %j without crashing and keeps the file config', (editor) => {
    expect(resolveConfiguration(fileConfig, editor)).toEqual(fileConfig);
  });

  it('ignores invalid shapes and types per field', () => {
    const editor = {
      languages: 'html',
      classAttributes: { className: true },
      templateTags: 'acme-card',
      diagnostics: 'nope',
    };
    expect(resolveConfiguration(fileConfig, editor)).toEqual(fileConfig);
  });

  it('ignores arrays with non-string members and bad enum values', () => {
    const editor = {
      languages: ['html', 7],
      templateTags: { html: 'acme-card', css: [1, 2] },
      classAttributes: [null],
      diagnostics: { deprecated: 'loud', packages: 'all' },
    };
    expect(resolveConfiguration(fileConfig, editor)).toEqual(fileConfig);
  });

  it('does not materialize nested containers from editor-only empty or invalid objects', () => {
    // File has no templateTags: an invalid/empty editor templateTags is a no-op.
    expect(resolveConfiguration({ languages: ['html'] }, { templateTags: {} })).toEqual({ languages: ['html'] });
    // File has no diagnostics: invalid editor diagnostics fields are a no-op.
    expect(
      resolveConfiguration(undefined, { diagnostics: { packages: { '@x/y': 1 } } }),
    ).toEqual({});
    // File containers are preserved (as copies) even when the editor fields are all invalid.
    expect(resolveConfiguration(fileConfig, { templateTags: { html: 'nope' } })).toEqual(fileConfig);
    expect(resolveConfiguration(fileConfig, { diagnostics: { packages: {} } })).toEqual(fileConfig);
  });

  it('ignores unknown editor keys, including sources and draftUsage', () => {
    const editor = {
      sources: { components: ['editor.json'] },
      discovery: { enabled: true },
      unknownOption: true,
      diagnostics: { draftUsage: 'off' },
    };
    expect(resolveConfiguration(fileConfig, editor)).toEqual(fileConfig);
  });

  it('injects nothing when there is no file config and the editor input is invalid', () => {
    expect(
      resolveConfiguration(undefined, {
        languages: 'html',
        templateTags: { html: 'x' },
        diagnostics: { deprecated: 'nope', packages: { a: 1 } },
      }),
    ).toEqual({});
  });
});

describe('immutability', () => {
  it('does not mutate fileConfig or editorSettings', () => {
    const editor: EditorRecognitionSettings = {
      languages: ['css'],
      templateTags: { html: ['card'] },
      diagnostics: { packages: { '@acme/ds': { deprecated: 'off' } } },
    };
    const fileBefore = JSON.parse(JSON.stringify(fileConfig));
    const editorBefore = JSON.parse(JSON.stringify(editor));
    const fileLanguages = fileConfig.languages;

    resolveConfiguration(fileConfig, editor);

    expect(fileConfig).toEqual(fileBefore);
    expect(editor).toEqual(editorBefore);
    expect(fileConfig.languages).toBe(fileLanguages); // original array reference untouched
  });

  it('returns a copy that does not share nested state with either input', () => {
    const editorLanguages = ['css'];
    const editor = { languages: editorLanguages };
    const result = resolveConfiguration(fileConfig, editor);

    expect(result).not.toBe(fileConfig);
    expect(result.languages).not.toBe(editorLanguages);
    expect(result.languages).not.toBe(fileConfig.languages);
    expect(result.diagnostics?.packages).not.toBe(fileConfig.diagnostics?.packages);

    result.languages.push('xml');
    const resultPackage = result.diagnostics?.packages?.['@acme/ds'];
    if (resultPackage) resultPackage.deprecated = 'off';
    expect(fileConfig.languages).toEqual(['html']);
    expect(fileConfig.diagnostics?.packages?.['@acme/ds'].deprecated).toBe('error');
    expect(editorLanguages).toEqual(['css']);
  });
});

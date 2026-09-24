import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateTokenDocument } from '../src/schema-validation.js';
import { getSchemaDiagnostics } from '../src/providers/schema-diagnostics.js';
import { parseCEM } from '../src/parsers/cem.js';

const manifest = (version: string) => ({ schemaVersion: version, tokens: [{ id: 'space.current', resolved: { base: '4px' }, deprecated: false, status: 'team-preview' }] });
const dtcg = { group: { $type: 'number', $extensions: { 'recipes.designlasagna': { status: 'removed' } }, current: { $value: 1, $deprecated: false } } };
describe('schema diagnostic lifecycle profiles', () => {
  it('selects native v0.4 by schemaVersion without project opt-in', () => {
    expect(validateTokenDocument(manifest('0.4.0'))).toEqual([]);
    expect(validateTokenDocument(manifest('0.3.0')).length).toBeGreaterThan(0);
    expect(validateTokenDocument(manifest('0.3.0'), '0.4').length).toBeGreaterThan(0);
  });
  it('requires explicit v0.4 selection for nested DTCG vendor status', () => {
    expect(validateTokenDocument(dtcg).some(e => e.schema === 'designlasagna-extension')).toBe(true);
    expect(validateTokenDocument(dtcg, '0.4')).toEqual([]);
  });
  it('routes the selected profile through the diagnostic provider', () => {
    const doc = TextDocument.create('file:///tokens.json', 'json', 1, JSON.stringify(dtcg));
    expect(getSchemaDiagnostics(doc).length).toBeGreaterThan(0);
    expect(getSchemaDiagnostics(doc, '0.4')).toEqual([]);
    const native = TextDocument.create('file:///tokens.json', 'json', 1, JSON.stringify(manifest('0.4.0')));
    expect(getSchemaDiagnostics(native)).toEqual([]);
  });
  it('still rejects empty canonical messages under v0.4', () => {
    const invalid = { schemaVersion: '0.4.0', tokens: [{ id: 'old', resolved: {}, deprecated: { message: '' } }] };
    expect(validateTokenDocument(invalid).some(e => e.keyword === 'minLength')).toBe(true);
  });
  it('correlates kebab-case attributes with camelCase members under the v0.4 profile', () => {
    const cem = { modules: [{ declarations: [{
      name: 'Correlated', tagName: 'x-correlated',
      attributes: [{ name: 'old-mode', fieldName: 'oldMode', deprecated: false }],
      members: [{
        name: 'oldMode', kind: 'field', type: { text: "'compact' | 'comfortable'" },
        deprecated: 'Use mode.', status: 'removed', removal: '2027-01-01', replacement: 'mode',
      }],
    }] }] };

    const [legacy] = parseCEM(cem, 'profiled');
    const [v04] = parseCEM(cem, 'profiled', '0.4');

    expect(legacy.attributes[0]).toMatchObject({
      name: 'oldMode', htmlName: 'old-mode', type: "'compact' | 'comfortable'",
      lifecycleState: 'active', lifecycleIssues: undefined,
    });
    expect(v04.attributes[0]).toMatchObject({
      name: 'oldMode', htmlName: 'old-mode', type: "'compact' | 'comfortable'",
      status: 'removed', lifecycleState: 'removed', removal: '2027-01-01', replacement: 'mode',
      lifecycleIssues: expect.arrayContaining(['lifecycle-conflict']),
    });
  });
  it('does not match a member attribute to an unrelated attribute fieldName', () => {
    const cem = { modules: [{ declarations: [{
      name: 'Correlated', tagName: 'x-correlated',
      attributes: [{ name: 'actual-attribute' }, { name: 'collision', fieldName: 'actual-attribute' }],
      members: [{
        name: 'actualProperty', kind: 'field', attribute: 'actual-attribute', type: { text: 'number' },
        deprecated: 'Use the replacement.', status: 'removed', replacement: 'replacement',
      }],
    }] }] };

    const [component] = parseCEM(cem, 'profiled', '0.4');

    expect(component.attributes[0]).toMatchObject({
      htmlName: 'actual-attribute', type: 'number', lifecycleState: 'removed', replacement: 'replacement',
    });
    expect(component.attributes[1]).toMatchObject({
      name: 'actual-attribute', htmlName: 'collision', type: 'string', lifecycleState: 'active',
      status: undefined, deprecated: false, replacement: undefined,
    });
  });
  it('applies nested CEM status lifecycle only under the v0.4 profile', () => {
    const cem = { modules: [{ declarations: [{
      name: 'Profiled', tagName: 'x-profiled', status: 'removed',
      attributes: [{ name: 'old-attribute', status: 'removed' }],
      members: [{ name: 'oldMember', kind: 'field', status: 'removed' }],
      slots: [{ name: 'old-slot', status: 'removed' }],
      events: [{ name: 'old-event', status: 'removed' }],
      cssParts: [{ name: 'old-part', status: 'removed' }],
      cssProperties: [{ name: '--old-property', status: { name: 'removed' } }],
    }] }] };
    const [legacy] = parseCEM(cem, 'profiled');
    const [v04] = parseCEM(cem, 'profiled', '0.4');
    const nested = (component: typeof legacy) => [
      component.attributes[0], component.properties?.[0], component.slots[0],
      component.events[0], component.cssParts[0], component.cssProperties[0],
    ];

    // Declaration-level status is established legacy behavior; nested status is v0.4-only.
    expect(legacy).toMatchObject({ status: 'removed', deprecated: true, lifecycleState: 'removed' });
    for (const item of nested(legacy)) expect(item).toMatchObject({ status: undefined, deprecated: false, lifecycleState: 'active' });
    for (const item of nested(v04)) expect(item).toMatchObject({ status: 'removed', deprecated: true, lifecycleState: 'removed' });
  });
});

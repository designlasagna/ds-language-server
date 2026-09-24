import type { DSAttribute, DSComponent, DSCssPart, DSCssProperty, DSDeprecatedValue, DSEvent, DSProperty, DSSlot } from '../types.js';
import { lifecycleFields, normalizeLifecycle } from '../lifecycle.js';

interface CEMManifest { modules: CEMModule[]; }
interface CEMModule { declarations?: CEMDeclaration[]; }
interface CEMDeclaration { name: string; tagName?: string; description?: string; deprecated?: boolean | string; removal?: string; replacement?: string; status?: { name: string } | string; attributes?: CEMAttribute[]; members?: CEMMember[]; slots?: CEMSlot[]; events?: CEMEvent[]; cssProperties?: CEMCssProperty[]; cssParts?: CEMCssPart[]; }
interface CEMAttribute { name: string; type?: string | { text: string }; default?: string | boolean | number; description?: string; deprecated?: boolean | string; status?: { name: string } | string; removal?: string; replacement?: string; fieldName?: string; enum?: string[]; deprecatedValues?: CEMDeprecatedValue[]; }
interface CEMMember { name: string; type?: string | { text: string } | string[]; default?: string | boolean | number; description?: string; deprecated?: boolean | string; status?: { name: string } | string; removal?: string; replacement?: string; attribute?: string; enum?: string[]; deprecatedValues?: CEMDeprecatedValue[]; kind?: string; privacy?: string; static?: boolean; readonly?: boolean; }
interface CEMDeprecatedValue { value: string; message: string; removal?: string; replacement?: string; }
interface CEMSlot { name: string; description?: string; deprecated?: boolean | string; status?: { name: string } | string; removal?: string; replacement?: string; }
interface CEMEvent { name: string; description?: string; type?: { text: string }; deprecated?: boolean | string; status?: { name: string } | string; removal?: string; replacement?: string; }
interface CEMCssProperty { name: string; description?: string; default?: string; deprecated?: boolean | string; status?: { name: string } | string; removal?: string; replacement?: string; syntax?: string; }
interface CEMCssPart { name: string; description?: string; deprecated?: boolean | string; status?: { name: string } | string; removal?: string; replacement?: string; }

/** CEM v0.4 lifecycle semantics require explicit config profile selection. */
export function parseCEM(json: unknown, source: string, lifecycleProfile?: '0.4'): DSComponent[] {
  const cem = json as CEMManifest;
  if (!Array.isArray(cem?.modules)) return [];
  return cem.modules.flatMap(module => (module.declarations ?? []).filter(decl => decl.tagName)
    .map(decl => parseDeclaration(decl, source, lifecycleProfile === '0.4')));
}

function status(value: CEMDeclaration['status']): string | undefined {
  const result = typeof value === 'string' ? value : value?.name;
  return result || undefined;
}

function parseDeclaration(decl: CEMDeclaration, source: string, v04: boolean): DSComponent {
  const lifecycle = normalizeLifecycle(decl.deprecated, status(decl.status), { removal: decl.removal, replacement: decl.replacement });
  // Legacy CEM already recognizes status-only components; v0.4 adds the full canonical state details.
  if (!v04 && decl.deprecated === false) {
    lifecycle.state = 'active';
    lifecycle.deprecated = false;
    lifecycle.message = undefined;
  } else if (!v04 && decl.deprecated === undefined && lifecycle.state === 'active') {
    lifecycle.deprecated = false;
  }
  // CEM producers can identify the duplicate representation from either side:
  // attributes use `fieldName`, while members use `attribute`.
  const members = indexMembers(decl.members ?? []);
  return { tagName: decl.tagName!, className: decl.name, description: decl.description || '', ...lifecycleFields(lifecycle),
    attributes: parseAttributes(decl.attributes ?? [], members, v04), slots: (decl.slots ?? []).map(slot => parseSlot(slot, v04)),
    events: (decl.events ?? []).map(event => parseEvent(event, v04)),
    cssProperties: (decl.cssProperties ?? []).map(prop => parseCssProperty(prop, v04)),
    cssParts: (decl.cssParts ?? []).map(part => parseCssPart(part, v04)),
    properties: parseProperties(decl.members ?? [], v04), source };
}

interface CEMMemberIndex { byAttribute: Map<string, CEMMember>; byName: Map<string, CEMMember>; }

function indexMembers(members: CEMMember[]): CEMMemberIndex {
  const byAttribute = new Map<string, CEMMember>();
  const byName = new Map<string, CEMMember>();
  for (const member of members) {
    byName.set(member.name, member);
    if (member.attribute) byAttribute.set(member.attribute, member);
  }
  return { byAttribute, byName };
}

function matchingMember(attr: CEMAttribute, members: CEMMemberIndex): CEMMember | undefined {
  return (attr.fieldName ? members.byName.get(attr.fieldName) : undefined)
    ?? members.byAttribute.get(attr.name)
    ?? members.byName.get(attr.name);
}

function parseAttributes(attrs: CEMAttribute[], members: CEMMemberIndex, v04: boolean): DSAttribute[] {
  return attrs.map(attr => {
    const member = matchingMember(attr, members);
    const attrLifecycle = normalizeLifecycle(attr.deprecated ?? member?.deprecated, v04 ? status(attr.status ?? member?.status) : undefined, {
      removal: attr.removal ?? member?.removal, replacement: attr.replacement ?? member?.replacement,
    });
    if (v04 && attr.deprecated !== undefined && member?.deprecated !== undefined && attr.deprecated !== member.deprecated) attrLifecycle.issues.push('lifecycle-conflict');
    const values = attr.enum ?? member?.enum;
    const explicitValues = attr.deprecatedValues ?? member?.deprecatedValues;
    const deprecatedValues = explicitValues?.map(value => ({ value: value.value, message: value.message, removal: value.removal, replacement: value.replacement }));
    // Legacy compatibility only: old manifests inferred values from prose. v0.4 never does.
    const inferred = !v04 && !deprecatedValues ? inferLegacyValues(attrLifecycle.message, values, attrLifecycle.removal) : undefined;
    // Retain the previous legacy adapter's prose behavior without letting it leak into v0.4.
    if (inferred?.length) {
      attrLifecycle.state = 'active';
      attrLifecycle.deprecated = false;
      attrLifecycle.message = undefined;
      attrLifecycle.removal = undefined;
      attrLifecycle.replacement = undefined;
    }
    const valueEntries = deprecatedValues ?? inferred;
    return { name: attr.fieldName ?? attr.name, htmlName: attr.name, type: typeOf(attr.type ?? member?.type),
      default: (attr.default ?? member?.default) === undefined ? undefined : String(attr.default ?? member?.default), description: attr.description ?? member?.description,
      ...lifecycleFields(attrLifecycle), values, deprecatedValues: valueEntries };
  });
}

function inferLegacyValues(message: string | undefined, values: string[] | undefined, removal: string | undefined): DSDeprecatedValue[] | undefined {
  const match = message?.match(/[`'"](\w+)[`'"]\s+(?:\w+\s+)?(?:is\s+)?(?:removed|deprecated)/i);
  if (!match || !values?.includes(match[1]) || !message) return undefined;
  return [{ value: match[1], message, removal, replacement: message.match(/[Uu]se\s+[`'"](\w+)[`'"]\s+instead/i)?.[1] }];
}
function parseSlot(slot: CEMSlot, v04: boolean): DSSlot { return { name: slot.name, description: slot.description, ...lifecycleFields(normalizeLifecycle(slot.deprecated, v04 ? status(slot.status) : undefined, { removal: slot.removal, replacement: slot.replacement })) }; }
function parseEvent(event: CEMEvent, v04: boolean): DSEvent { return { name: event.name, description: event.description, type: event.type?.text, ...lifecycleFields(normalizeLifecycle(event.deprecated, v04 ? status(event.status) : undefined, { removal: event.removal, replacement: event.replacement })) }; }
function parseCssPart(part: CEMCssPart, v04: boolean): DSCssPart { return { name: part.name, description: part.description, ...lifecycleFields(normalizeLifecycle(part.deprecated, v04 ? status(part.status) : undefined, { removal: part.removal, replacement: part.replacement })) }; }
/** Public, nonstatic, writable field members (including those without a reflected attribute); legacy members omitting `kind` are accepted. */
function parseProperties(members: CEMMember[], v04: boolean): DSProperty[] {
  return members
    .filter(member => (member.kind === undefined || member.kind === 'field')
      && member.privacy !== 'private' && member.privacy !== 'protected'
      && member.static !== true && member.readonly !== true)
    .map(member => ({ name: member.name, type: typeOf(member.type), description: member.description,
      default: member.default === undefined ? undefined : String(member.default),
      ...lifecycleFields(normalizeLifecycle(member.deprecated, v04 ? status(member.status) : undefined, { removal: member.removal, replacement: member.replacement })) }));
}
function parseCssProperty(prop: CEMCssProperty, v04: boolean): DSCssProperty { return { name: prop.name, description: prop.description, default: prop.default, syntax: prop.syntax, ...lifecycleFields(normalizeLifecycle(prop.deprecated, v04 ? status(prop.status) : undefined, { removal: prop.removal, replacement: prop.replacement })) }; }
function typeOf(value: CEMAttribute['type'] | CEMMember['type']): string { if (!value) return 'string'; if (typeof value === 'string') return value; if (Array.isArray(value)) return value.join(' | '); return value.text; }

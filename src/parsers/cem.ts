import type { DSAttribute, DSComponent, DSCssPart, DSCssProperty, DSDeprecatedValue, DSEvent, DSSlot } from '../types.js';
import { lifecycleFields, normalizeLifecycle } from '../lifecycle.js';

interface CEMManifest { modules: CEMModule[]; }
interface CEMModule { declarations?: CEMDeclaration[]; }
interface CEMDeclaration { name: string; tagName?: string; description?: string; deprecated?: boolean | string; removal?: string; replacement?: string; status?: { name: string } | string; attributes?: CEMAttribute[]; members?: CEMMember[]; slots?: CEMSlot[]; events?: CEMEvent[]; cssProperties?: CEMCssProperty[]; cssParts?: CEMCssPart[]; }
interface CEMAttribute { name: string; type?: string | { text: string }; default?: string | boolean | number; description?: string; deprecated?: boolean | string; removal?: string; replacement?: string; fieldName?: string; enum?: string[]; deprecatedValues?: CEMDeprecatedValue[]; }
interface CEMMember { name: string; type?: string | { text: string } | string[]; default?: string | boolean | number; description?: string; deprecated?: boolean | string; removal?: string; replacement?: string; attribute?: string; enum?: string[]; deprecatedValues?: CEMDeprecatedValue[]; }
interface CEMDeprecatedValue { value: string; message: string; removal?: string; replacement?: string; }
interface CEMSlot { name: string; description?: string; deprecated?: boolean | string; removal?: string; replacement?: string; }
interface CEMEvent { name: string; description?: string; type?: { text: string }; }
interface CEMCssProperty { name: string; description?: string; default?: string; deprecated?: boolean | string; removal?: string; replacement?: string; syntax?: string; }
interface CEMCssPart { name: string; description?: string; }

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
  // CEM producers use either `attribute` or the matching member name for the
  // attribute/member duplicate representation; both identify the same axis.
  const members = new Map((decl.members ?? []).map(member => [member.attribute ?? member.name, member]));
  return { tagName: decl.tagName!, className: decl.name, description: decl.description || '', ...lifecycleFields(lifecycle),
    attributes: parseAttributes(decl.attributes ?? [], members, v04), slots: (decl.slots ?? []).map(parseSlot),
    events: (decl.events ?? []).map(event => ({ name: event.name, description: event.description, type: event.type?.text })),
    cssProperties: (decl.cssProperties ?? []).map(parseCssProperty), cssParts: (decl.cssParts ?? []).map(part => ({ name: part.name, description: part.description })), source };
}

function parseAttributes(attrs: CEMAttribute[], members: Map<string, CEMMember>, v04: boolean): DSAttribute[] {
  return attrs.map(attr => {
    const member = members.get(attr.name);
    const attrLifecycle = normalizeLifecycle(attr.deprecated ?? member?.deprecated, undefined, {
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
function parseSlot(slot: CEMSlot): DSSlot { return { name: slot.name, description: slot.description, ...lifecycleFields(normalizeLifecycle(slot.deprecated, undefined, { removal: slot.removal, replacement: slot.replacement })) }; }
function parseCssProperty(prop: CEMCssProperty): DSCssProperty { return { name: prop.name, description: prop.description, default: prop.default, syntax: prop.syntax, ...lifecycleFields(normalizeLifecycle(prop.deprecated, undefined, { removal: prop.removal, replacement: prop.replacement })) }; }
function typeOf(value: CEMAttribute['type'] | CEMMember['type']): string { if (!value) return 'string'; if (typeof value === 'string') return value; if (Array.isArray(value)) return value.join(' | '); return value.text; }

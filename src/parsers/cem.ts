import type {
  DSComponent,
  DSAttribute,
  DSSlot,
  DSEvent,
  DSCssProperty,
  DSCssPart,
  DSDeprecatedValue,
  Status,
} from '../types.js';

// ─── CEM Types (subset we care about) ─────────────────────────────

interface CEMManifest {
  schemaVersion: string;
  modules: CEMModule[];
}

interface CEMModule {
  kind: string;
  path: string;
  declarations?: CEMDeclaration[];
  exports?: CEMExport[];
}

interface CEMExport {
  kind: string;
  name: string;
  declaration: { name: string; module?: string };
}

interface CEMDeclaration {
  kind: string;
  name: string;
  tagName?: string;
  description?: string;
  deprecated?: boolean | string;
  removal?: string;
  status?: { name: string; description?: string } | string;
  customElement?: boolean;
  attributes?: CEMAttribute[];
  members?: CEMMember[];
  slots?: CEMSlot[];
  events?: CEMEvent[];
  cssProperties?: CEMCssProperty[];
  cssParts?: CEMCssPart[];
  superclass?: { name: string; module?: string };
  mixins?: { name: string; module?: string }[];
}

interface CEMAttribute {
  name: string;
  type?: string | { text: string };
  default?: string | boolean | number;
  description?: string;
  deprecated?: boolean | string;
  removal?: string;
  fieldName?: string;
  attribute?: string;
  enum?: string[];
  deprecatedValues?: CEMDeprecatedValue[];
}

interface CEMMember {
  kind: string;
  name: string;
  type?: string | { text: string } | string[];
  default?: string | boolean | number;
  description?: string;
  deprecated?: boolean | string;
  removal?: string;
  attribute?: string;
  enum?: string[];
  privacy?: string;
  deprecatedValues?: CEMDeprecatedValue[];
}

interface CEMDeprecatedValue {
  value: string;
  message: string;
  removal?: string;
  replacement?: string;
}

interface CEMSlot {
  name: string;
  description?: string;
}

interface CEMEvent {
  name: string;
  description?: string;
  type?: { text: string };
}

interface CEMCssProperty {
  name: string;
  description?: string;
  default?: string;
  deprecated?: boolean | string;
  syntax?: string;
}

interface CEMCssPart {
  name: string;
  description?: string;
}

// ─── Parser ────────────────────────────────────────────────────────

/**
 * Parse a Custom Elements Manifest and return normalized DSComponent[].
 */
export function parseCEM(json: unknown, source: string): DSComponent[] {
  const cem = json as CEMManifest;
  if (!cem.modules || !Array.isArray(cem.modules)) return [];

  const components: DSComponent[] = [];

  for (const mod of cem.modules) {
    if (!mod.declarations) continue;

    for (const decl of mod.declarations) {
      // Only process custom element declarations
      if (!decl.tagName) continue;

      const component = parseDeclaration(decl, source);
      components.push(component);
    }
  }

  return components;
}

function parseDeclaration(decl: CEMDeclaration, source: string): DSComponent {
  const status = parseStatus(decl.status);
  const deprecated = parseDeprecated(decl.deprecated);

  // Build a map of members by attribute name for enrichment
  const membersByAttribute = new Map<string, CEMMember>();
  if (decl.members) {
    for (const member of decl.members) {
      if (member.attribute) {
        membersByAttribute.set(member.attribute, member);
      }
    }
  }

  return {
    tagName: decl.tagName!,
    className: decl.name,
    description: decl.description || '',
    status,
    deprecated: deprecated.isDeprecated,
    deprecationMessage: deprecated.message,
    removal: decl.removal,
    attributes: parseAttributes(decl.attributes || [], membersByAttribute),
    slots: parseSlots(decl.slots || []),
    events: parseEvents(decl.events || []),
    cssProperties: parseCssProperties(decl.cssProperties || []),
    cssParts: parseCssParts(decl.cssParts || []),
    source,
  };
}

function parseAttributes(
  attrs: CEMAttribute[],
  membersByAttribute: Map<string, CEMMember>,
): DSAttribute[] {
  return attrs.map((attr) => {
    // Enrich from member data (members often have more info than attributes)
    const member = membersByAttribute.get(attr.name);

    const deprecated = parseDeprecated(attr.deprecated ?? member?.deprecated);
    const type = resolveType(attr.type ?? member?.type);
    const defaultVal = attr.default ?? member?.default;
    const enumValues = attr.enum ?? member?.enum;
    const removal = attr.removal ?? member?.removal;
    const deprecatedValues = attr.deprecatedValues ?? member?.deprecatedValues;

    // Detect deprecated values from deprecation message + enum
    const detectedDeprecatedValues = detectDeprecatedValues(
      deprecated,
      enumValues,
      deprecatedValues,
      removal,
    );

    // Determine active values (enum values minus deprecated ones)
    const deprecatedValueNames = new Set(detectedDeprecatedValues.map((v) => v.value));
    const activeValues = enumValues?.filter((v) => !deprecatedValueNames.has(v));

    return {
      name: attr.fieldName ?? attr.name,
      htmlName: attr.name,
      type,
      default: defaultVal !== undefined ? String(defaultVal) : undefined,
      description: attr.description ?? member?.description,
      deprecated: deprecated.isDeprecated,
      deprecationMessage: deprecated.message,
      removal,
      values: activeValues ?? enumValues,
      deprecatedValues: detectedDeprecatedValues.length > 0 ? detectedDeprecatedValues : undefined,
    };
  });
}

/**
 * Detect deprecated values by analyzing the deprecation message
 * and cross-referencing with enum values.
 *
 * Example: deprecated="The `tertiary` variant is removed. Use `secondary` instead."
 * with enum=["primary","secondary","tertiary"]
 * → detects "tertiary" as deprecated with replacement "secondary"
 */
function detectDeprecatedValues(
  deprecated: { isDeprecated: boolean; message?: string },
  enumValues: string[] | undefined,
  explicitDeprecated: CEMDeprecatedValue[] | undefined,
  removal: string | undefined,
): DSDeprecatedValue[] {
  // If there are explicit deprecated values, use those
  if (explicitDeprecated && explicitDeprecated.length > 0) {
    return explicitDeprecated.map((dv) => ({
      value: dv.value,
      message: dv.message,
      removal: dv.removal ?? removal,
      replacement: dv.replacement,
    }));
  }

  // Try to detect from deprecation message + enum
  if (!deprecated.isDeprecated || !deprecated.message || !enumValues) {
    return [];
  }

  const msg = deprecated.message;
  const result: DSDeprecatedValue[] = [];

  // Pattern: "The `VALUE` ... is removed/deprecated. Use `REPLACEMENT` instead."
  const valuePattern = /[`'"](\w+)[`'"]\s+(?:\w+\s+)?(?:is\s+)?(?:removed|deprecated)/i;
  const replacementPattern = /[Uu]se\s+[`'"](\w+)[`'"]\s+instead/i;

  const valueMatch = msg.match(valuePattern);
  const replacementMatch = msg.match(replacementPattern);

  if (valueMatch) {
    const value = valueMatch[1];
    // Verify it's actually an enum value
    if (enumValues.includes(value)) {
      result.push({
        value,
        message: msg,
        removal,
        replacement: replacementMatch?.[1],
      });
    }
  }

  return result;
}

function parseSlots(slots: CEMSlot[]): DSSlot[] {
  return slots.map((s) => ({
    name: s.name,
    description: s.description,
  }));
}

function parseEvents(events: CEMEvent[]): DSEvent[] {
  return events.map((e) => ({
    name: e.name,
    description: e.description,
    type: e.type?.text,
  }));
}

function parseCssProperties(props: CEMCssProperty[]): DSCssProperty[] {
  return props.map((p) => {
    const deprecated = parseDeprecated(p.deprecated);
    return {
      name: p.name,
      description: p.description,
      default: p.default,
      syntax: p.syntax,
      deprecated: deprecated.isDeprecated,
      deprecationMessage: deprecated.message,
    };
  });
}

function parseCssParts(parts: CEMCssPart[]): DSCssPart[] {
  return parts.map((p) => ({
    name: p.name,
    description: p.description,
  }));
}

// ─── Helpers ───────────────────────────────────────────────────────

function parseStatus(
  status: { name: string; description?: string } | string | undefined,
): Status | undefined {
  if (!status) return undefined;
  const name = typeof status === 'string' ? status : status.name;
  if (['draft', 'beta', 'ready', 'deprecated'].includes(name)) {
    return name as Status;
  }
  return undefined;
}

function parseDeprecated(
  deprecated: boolean | string | undefined,
): { isDeprecated: boolean; message?: string } {
  if (deprecated === undefined || deprecated === false) {
    return { isDeprecated: false };
  }
  if (deprecated === true) {
    return { isDeprecated: true };
  }
  // String — it's the deprecation message
  return { isDeprecated: true, message: deprecated };
}

function resolveType(type: string | { text: string } | string[] | undefined): string {
  if (!type) return 'string';
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.join(' | ');
  if (typeof type === 'object' && 'text' in type) return type.text;
  return 'string';
}

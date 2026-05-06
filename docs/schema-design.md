# Schema Design: Design System Manifests

## Context

The DS Language Server consumes three types of manifests:
1. **Components** — Custom Elements Manifest (CEM)
2. **Tokens** — Design token definitions
3. **Utilities** — CSS utility class definitions

These manifests serve multiple consumers:
- **LSP** — completions, hover, diagnostics, code actions
- **Documentation site** — auto-generated API docs
- **Type generation** — TypeScript `.d.ts` files
- **Design tools** — Figma/Storybook integrations
- **Linters** — custom ESLint/Stylelint rules
- **Migration tools** — codemods for deprecated → replacement

This document defines what each schema needs, how deprecation is expressed at authoring time vs. manifest time, and where schemas should be hosted.

---

## Key Architectural Insight

```
Raw source (Figma export / JSDoc / CSS comments)
        ↓
  Build pipeline (design-system-specific)
        ↓
  Parsed manifest (standardized schema)  ←── LSP reads THIS
```

The LSP only reads **parsed manifests** that conform to a known schema. It doesn't read raw DTCG, doesn't parse JSDoc, doesn't understand Figma. The build pipeline is the design system's responsibility — it can read deprecation from wherever (description text, extensions, comments) and emit a standard `deprecated` object.

This means:
- The manifest schema is the API contract — any DS that produces conforming manifests works
- Extension namespaces (W3C DTCG `$extensions`) are a build-pipeline concern, not an LSP concern
- The LSP is truly generic

---

## 1. Components — Custom Elements Manifest (CEM)

### Standard: Already defined
CEM is an established spec: https://github.com/webcomponents/custom-elements-manifest

**LFDS extensions to CEM** (non-standard fields):
- `removal` — date or version when deprecated item is removed
- `enum` — attribute value options (non-standard but widely used)
- `status` — component lifecycle status (draft/ready/deprecated)

### How deprecation is authored (source)

**Attribute-level deprecation** (the whole attribute is deprecated):
```ts
/**
 * @deprecated Use `default` slot instead
 * @removal 2026-07-30
 */
@property() label: string
```

**Value-level deprecation** (only specific values are deprecated):
```ts
/**
 * @deprecatedValue tertiary - Use `secondary` instead.
 * @deprecatedValue medium - Use `small` instead.
 * @removal 2026-07-30
 */
@property() variant: 'primary' | 'secondary' | 'tertiary' = 'primary'
```

The `@deprecatedValue` tag targets individual enum values without marking the attribute itself as deprecated. The `@removal` applies to all deprecated values (or can be per-value with `@removalValue tertiary 2026-07-30`).

### How it appears in the manifest (CEM output)

**Attribute-level:**
```json
{
  "name": "label",
  "type": "string",
  "deprecated": "Use `default` slot instead",
  "removal": "2026-07-30",
  "replacement": "default slot"
}
```

**Value-level:**
```json
{
  "name": "variant",
  "type": "string",
  "default": "primary",
  "enum": ["primary", "secondary", "tertiary"],
  "deprecatedValues": [
    {
      "value": "tertiary",
      "message": "Use `secondary` instead.",
      "removal": "2026-07-30",
      "replacement": "secondary"
    }
  ]
}
```

Note: the attribute itself is **not** marked `deprecated` — only specific values have deprecation info. This is critical for correct LSP behavior (don't flag the attribute, only flag the value when used).

### What the LSP needs from CEM
| Field | Purpose |
|-------|---------|
| `tagName` | Tag completion, diagnostics scope |
| `status` | Draft/deprecated component warnings |
| `attributes[].name` | Attribute name completions |
| `attributes[].type` | Hover info |
| `attributes[].enum` | Value completions |
| `attributes[].deprecated` | Mark deprecated in completions + diagnostics |
| `attributes[].removal` | Time-aware severity escalation |
| `attributes[].replacement` | Code action (auto-fix) |
| `attributes[].deprecatedValues[]` | **Value-level** deprecation (only flag specific values) |
| `members[].deprecated` | Same (mirrors attributes) |
| `members[].removal` | Same |
| `slots[].name` | Slot value completions |
| `slots[].description` | Hover info for slots |
| `slots[].deprecated` | Deprecated slot warnings |
| `slots[].removal` | Time-aware severity |
| `events[].name` | Event completions (future) |
| `cssProperties[].name` | Component-scoped CSS vars |
| `description` | Hover for component tag |

### What documentation needs additionally
| Field | Purpose |
|-------|---------|
| `description` | Component overview |
| `members[].description` | Property docs |
| `attributes[].default` | Default values table |
| `events[].description` | Event docs |
| `cssParts[].name` | Styling API docs |
| `cssProperties[].default` | Token defaults |
| `status` | Badge/banner on docs page |
| `removal` | Deprecation timeline/banner |

### Schema decision: Keep CEM + extensions
No need to invent a new schema. CEM is standard. We add:
- `removal` (string — ISO date or semver)
- `replacement` (string — what to use instead)
- `status` (string — "draft" | "ready" | "deprecated")
- `enum` (string[] — for value enumeration)
- `deprecatedValues` (array — value-level deprecation without marking the attribute)

These are already in use (except `deprecatedValues` and `replacement`) and backward-compatible (ignored by tools that don't understand them).

---

## 2. Tokens — `parsed-tokens.schema.json`

### Current state
LFDS uses a custom "parsed tokens" format that is purpose-built after resolving W3C DTCG raw tokens. There is NO deprecation in the current token pipeline — the deprecated token in our test fixtures was hand-crafted.

### Authoring deprecation in tokens

**Reality: Tokens come from Figma.** The raw DTCG JSON is exported from Figma's Variables API. You can't add `$extensions` in Figma's UI. The practical approach is marking deprecation in the **description field** in Figma:

```
[DEPRECATED 2026-07-30: Use color.interactive.primary-pressed instead.] Primary button pressed background.
```

This is the same pattern already used for slots in the CEM plugin. Figma's Variables UI has a description field — that's where authors mark deprecation.

**How the build pipeline handles it:**

```js
// In viewer-tokens.js — same regex pattern as CEM slot processing
const deprecationPattern =
  /^\[DEPRECATED(?:\s+([vQ\d][\w.\-/]*))?(?::\s*([^\]]+))?\]\s*/i

function extractDeprecation(description) {
  if (!description) return { deprecated: null, cleanDescription: description }
  const match = description.match(deprecationPattern)
  if (!match) return { deprecated: null, cleanDescription: description }
  return {
    deprecated: {
      message: match[2]?.trim() || 'Deprecated.',
      removal: match[1]?.trim() || undefined,
    },
    cleanDescription: description.replace(deprecationPattern, '').trim()
  }
}
```

**The `$extensions` approach** is available as a secondary source for hand-authored tokens (not from Figma). Any namespaced key can be used — the build pipeline is DS-specific and knows where to look. The LSP never reads raw DTCG directly.

**Overlay file** (`deprecated-tokens.json`) is available as an escape hatch for adding `replacement` info that can't fit in a Figma description:
```json
{
  "deprecated": [
    {
      "id": "color.bg.button-primary-pressed",
      "replacement": "--lfds-color-interactive-primary-pressed"
    }
  ]
}
```
The build pipeline merges this with parsed description data.

### Parsed tokens manifest schema (v0.3.0)

```json
{
  "$schema": "https://ds.magnus.dev/schemas/v1/tokens.json",
  "schemaVersion": "0.3.0",
  "generatedAt": "2026-05-06T00:00:00Z",
  "tokens": [
    {
      "id": "color.bg.button-primary-pressed",
      "path": ["color", "bg", "button-primary-pressed"],
      "group": "Color",
      "category": "Background",
      "type": "color",
      "description": "Primary button pressed background.",
      "cssVariable": "--lfds-color-background-button-primary-pressed",
      "resolved": {
        "light": "#00427a",
        "dark": "#52a8e1"
      },
      "modes": {
        "light": "{color.blue.700}",
        "dark": "{color.blue.300}"
      },

      "deprecated": {
        "message": "Use `--lfds-color-interactive-primary-pressed` instead.",
        "removal": "2026-07-30",
        "replacement": "--lfds-color-interactive-primary-pressed"
      },

      "visibility": {
        "isComponent": false,
        "isPrimitive": false
      },
      "tags": [],
      "sourceFiles": ["Color.light.tokens.json"]
    }
  ]
}
```

### Key schema changes from v0.2.0 → v0.3.0:
1. **`deprecated` becomes an object** (not just `true`) — structured with message, removal, replacement
2. Remove top-level `deprecationMessage`, `removal`, `replacement` (fold into `deprecated` object)
3. This matches CEM's pattern where `deprecated` can be `string | boolean` but we make it richer

### What the LSP needs from tokens
| Field | Purpose |
|-------|---------|
| `cssVariable` | Match `var(--...)` in code |
| `description` | Hover info |
| `type` | Hover (dimension, color, etc.) |
| `group` + `category` | Hover context, completion sorting |
| `resolved` | Show actual value in hover/completion |
| `deprecated.message` | Diagnostic message |
| `deprecated.removal` | Time-aware severity |
| `deprecated.replacement` | Code action (auto-fix) |

### What documentation needs additionally
| Field | Purpose |
|-------|---------|
| `id` + `path` | Token hierarchy navigation |
| `modes` | Show all mode values (light/dark/min/max) |
| `resolved` (all modes) | Value tables |
| `aliasChain` | Show token relationships |
| `visibility` | Filter component/primitive tokens |
| `tags` | Categorization/filtering |
| `sourceFiles` | Link to source |
| `deprecated` | Show deprecation banners with dates |
| `metadata.extensions` | Figma variable links |

---

## 3. Utilities — `utilities.manifest.json`

### Current state
Minimal schema — just `name` and `description`. No deprecation, no values, no JSON Schema.

### Proposed schema (v1.0.0)

```json
{
  "$schema": "https://ds.magnus.dev/schemas/v1/utilities.json",
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-05-06T00:00:00Z",
  "categories": [
    {
      "name": "Text Style – Heading",
      "description": "Typography heading utilities.",
      "prefix": "lf-text-heading-",
      "classes": [
        {
          "name": "lf-text-heading-1",
          "description": "Typography style heading level-1",
          "properties": {
            "font-size": "var(--lfds-typography-heading-1-font-size)",
            "line-height": "var(--lfds-typography-heading-1-line-height)",
            "font-weight": "var(--lfds-typography-heading-1-font-weight)"
          },
          "tokens": [
            "--lfds-typography-heading-1-font-size",
            "--lfds-typography-heading-1-line-height",
            "--lfds-typography-heading-1-font-weight"
          ],
          "deprecated": null
        },
        {
          "name": "lf-text-subtitle",
          "description": "Typography style subtitle",
          "properties": {
            "font-size": "14px",
            "font-weight": "600"
          },
          "deprecated": {
            "message": "Use `lf-text-heading-6` instead.",
            "removal": "2026-09-01",
            "replacement": "lf-text-heading-6"
          }
        }
      ]
    }
  ]
}
```

### What the LSP needs from utilities
| Field | Purpose |
|-------|---------|
| `classes[].name` | Class name completions |
| `classes[].description` | Hover info |
| `categories[].name` | Completion grouping |
| `classes[].deprecated.message` | Diagnostic message |
| `classes[].deprecated.removal` | Time-aware severity |
| `classes[].deprecated.replacement` | Code action |

### What documentation needs additionally
| Field | Purpose |
|-------|---------|
| `classes[].properties` | Show what CSS the class generates |
| `classes[].tokens` | Cross-reference to token docs |
| `categories[].description` | Category intro text |
| `categories[].prefix` | Grouping in docs navigation |
| `deprecated` | Deprecation banners |

### How to author deprecation in utility source CSS

```css
/* @deprecated Use `lf-text-heading-6` instead. @removal 2026-09-01 */
.lf-text-subtitle {
  font-size: 14px;
  font-weight: 600;
}
```

The build script (`build-utilities-manifest.mjs`) would parse these structured comments and emit the `deprecated` object in the manifest.

---

## 4. The Deprecation Object — Unified Shape

All three manifests use the **same deprecation shape**:

```typescript
interface Deprecated {
  /** Human-readable message explaining why and what to use instead */
  message: string;

  /**
   * When the item will be removed.
   * ISO date (2026-07-30) or semver (4.0.0) or quarter (Q3-2026).
   */
  removal?: string;

  /**
   * Machine-readable replacement identifier.
   * For tokens: CSS variable name (--lfds-color-interactive-primary-pressed)
   * For utilities: class name (lf-text-heading-6)
   * For component attrs: the replacement attribute name or instruction
   */
  replacement?: string;
}
```

### In CEM (components)
CEM's own `deprecated` field is `string | boolean`. We overlay with sibling fields:

**Attribute-level** (whole attribute deprecated):
```json
{
  "name": "label",
  "deprecated": "Use `default` slot instead",
  "removal": "2026-07-30",
  "replacement": "default slot"
}
```

**Value-level** (only specific values deprecated — attribute itself is NOT deprecated):
```json
{
  "name": "variant",
  "enum": ["primary", "secondary", "tertiary"],
  "deprecatedValues": [
    {
      "value": "tertiary",
      "message": "Use `secondary` instead.",
      "removal": "2026-07-30",
      "replacement": "secondary"
    }
  ]
}
```

The LSP handles both: if `deprecated` is present, the whole attribute is deprecated. If `deprecatedValues` is present, only those specific values trigger warnings.

### In tokens
```json
{
  "deprecated": {
    "message": "Use `--lfds-color-interactive-primary-pressed` instead.",
    "removal": "2026-07-30",
    "replacement": "--lfds-color-interactive-primary-pressed"
  }
}
```

### In utilities
Same as tokens:
```json
{
  "deprecated": {
    "message": "Use `lf-text-heading-6` instead.",
    "removal": "2026-09-01",
    "replacement": "lf-text-heading-6"
  }
}
```

### Why the difference?
- **CEM** — we must respect the existing spec where `deprecated` is `string | boolean`. We add `removal` and `replacement` as sibling fields.
- **Tokens & Utilities** — our own schemas, so we can use a proper nested object.

The LSP normalizes both patterns internally into the same `DeprecationInfo` type.

---

## 5. Schema Hosting

### Decision: `ds.magnus.dev`

Schemas are hosted at `https://ds.magnus.dev/schemas/` — a subdomain of `magnus.dev`.

**URL structure:**
```
https://ds.magnus.dev/schemas/v1/tokens.json
https://ds.magnus.dev/schemas/v1/utilities.json
https://ds.magnus.dev/schemas/v1/cem-extensions.json
```

**Why this works:**
- Domain already owned and controlled
- Can redirect to a dedicated domain later if the project grows
- Static JSON hosting (GitHub Pages, Cloudflare Pages, or similar)
- Versioned path (`/v1/`) allows breaking changes without breaking existing manifests

### Distribution layers

1. **URL** (`$schema` field): `https://ds.magnus.dev/schemas/v1/tokens.json`
   - Enables IDE JSON validation when opening manifest files
   - Accessible publicly

2. **npm package** (optional): `ds-manifest-schemas`
   - Versioned alongside the manifests
   - Available offline via `node_modules`
   - CI validation: `ajv validate -s node_modules/ds-manifest-schemas/v1/tokens.json -d dist/tokens.json`

3. **Bundled in LSP**: The language server ships with a copy
   - Works even if the URL is unreachable (corporate proxies, offline)

---

## 6. Discovery — How tools find the manifests

### In `package.json`

```json
{
  "name": "@lansforsakringar/core-components",
  "customElements": "dist/lit/custom-elements.json",
  "designSystem": {
    "tokens": "dist/lfds-tokens.json",
    "utilities": "dist/utilities.manifest.json"
  }
}
```

- `customElements` — standard CEM field, already supported by many tools
- `designSystem.tokens` — our convention
- `designSystem.utilities` — our convention

### In `ds.config.js` (project-level override)

```js
export default {
  packages: ['@lansforsakringar/core-components', '@lansforsakringar/core-css'],
  // Or explicit paths:
  manifests: {
    components: ['./node_modules/@lfds/components/custom-elements.json'],
    tokens: ['./node_modules/@lfds/tokens/lfds-tokens.json'],
    utilities: ['./node_modules/@lfds/css/utilities.manifest.json'],
  }
}
```

---

## 7. Source-Level Deprecation Patterns

### Components (TypeScript + JSDoc)

**Attribute-level:**
```ts
/**
 * @deprecated Use `default` slot instead
 * @removal 2026-07-30
 * @replacement default slot
 */
@property() label: string
```

**Value-level (NEW — `@deprecatedValue` tag):**
```ts
/**
 * @deprecatedValue tertiary - Use `secondary` instead.
 * @deprecatedValue medium - Use `small` instead.
 * @removal 2026-07-30
 */
@property() variant: 'primary' | 'secondary' | 'tertiary' = 'primary'
```

**Build tool**: `vite-plugin-cem` + custom `analyzePhase`:
- Extracts `@removal` tag (already done)
- NEW: Extracts `@deprecatedValue` tags → emits `deprecatedValues[]` array
- NEW: Extracts `@replacement` tag → emits `replacement` field
- When `@deprecatedValue` is present, does NOT mark the attribute itself as deprecated

### Tokens (Figma → description field)

In Figma's Variables UI, mark the description:
```
[DEPRECATED 2026-07-30: Use color.interactive.primary-pressed instead.] Primary button pressed background.
```

Optionally, for hand-authored tokens outside Figma (`$extensions`):
```json
{
  "$description": "Primary button pressed background.",
  "$extensions": {
    "com.lfds.deprecated": {
      "message": "Use color.interactive.primary-pressed instead.",
      "removal": "2026-07-30",
      "replacement": "color.interactive.primary-pressed"
    }
  }
}
```

**Build tool**: `viewer-tokens.js` parses `[DEPRECATED ...]` from `$description` (primary source) and/or reads from `$extensions` (secondary source). Optionally merges a `deprecated-tokens.json` overlay for `replacement` info.

### Utilities (CSS comments)

```css
/**
 * @deprecated Use `lf-text-heading-6` instead.
 * @removal 2026-09-01
 * @replacement lf-text-heading-6
 */
.lf-text-subtitle {
  font-size: 14px;
  font-weight: 600;
}
```

**Build tool**: `build-utilities-manifest.mjs` parses structured JSDoc-like comments preceding `.lf-*` rules.

### Slots, CSS Parts, Events (description field)

Same Figma-like pattern — deprecation in the description text:
```ts
/**
 * @slot icon - [DEPRECATED 2026-09-01: Use `start` slot instead.] Icon slot.
 */
```

**Build tool**: CEM plugin's `packageLinkPhase` already handles this pattern.

---

## 8. Full Schema Definitions

### `tokens.schema.json` (v1.0.0)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Design System Tokens Manifest",
  "type": "object",
  "required": ["schemaVersion", "tokens"],
  "properties": {
    "$schema": { "type": "string" },
    "schemaVersion": { "type": "string", "const": "1.0.0" },
    "generatedAt": { "type": "string", "format": "date-time" },
    "source": {
      "type": "object",
      "properties": {
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "file": { "type": "string" },
              "mode": { "type": "string" }
            }
          }
        }
      }
    },
    "counts": {
      "type": "object",
      "properties": {
        "total": { "type": "integer" },
        "byGroup": { "type": "object", "additionalProperties": { "type": "integer" } },
        "byCategory": { "type": "object", "additionalProperties": { "type": "integer" } }
      }
    },
    "tokens": {
      "type": "array",
      "items": { "$ref": "#/definitions/Token" }
    }
  },
  "definitions": {
    "Token": {
      "type": "object",
      "required": ["id", "path", "group", "category", "cssVariable", "resolved"],
      "properties": {
        "id": { "type": "string", "description": "Dot-separated token identifier" },
        "path": { "type": "array", "items": { "type": "string" } },
        "originalPath": { "type": "array", "items": { "type": "string" } },
        "group": { "type": "string", "description": "Top-level grouping (Color, Border, Spacing, etc.)" },
        "category": { "type": "string", "description": "Sub-group (Background, Radius, etc.)" },
        "subCategory": { "type": ["string", "null"] },
        "type": { "type": ["string", "null"], "description": "Token type (color, dimension, etc.)" },
        "description": { "type": ["string", "null"] },
        "cssVariable": { "type": ["string", "null"], "description": "CSS custom property name" },
        "resolved": {
          "type": "object",
          "description": "Resolved values per mode",
          "additionalProperties": {}
        },
        "modes": {
          "type": "object",
          "description": "Authored values (may contain aliases)",
          "additionalProperties": {}
        },
        "aliasChain": {
          "description": "Resolution chain for documentation",
          "oneOf": [
            { "type": "string" },
            { "type": "array", "items": { "type": "string" } }
          ]
        },
        "deprecated": {
          "oneOf": [
            { "type": "null" },
            { "$ref": "#/definitions/Deprecated" }
          ]
        },
        "visibility": {
          "type": "object",
          "properties": {
            "isComponent": { "type": "boolean" },
            "isPrimitive": { "type": "boolean" }
          }
        },
        "tags": { "type": "array", "items": { "type": "string" } },
        "sourceFiles": { "type": "array", "items": { "type": "string" } },
        "metadata": { "type": "object", "additionalProperties": true }
      }
    },
    "Deprecated": {
      "type": "object",
      "required": ["message"],
      "properties": {
        "message": { "type": "string", "description": "Human-readable deprecation reason" },
        "removal": { "type": "string", "description": "ISO date (2026-07-30), semver (4.0.0), or quarter (Q3-2026)" },
        "replacement": { "type": "string", "description": "Machine-readable replacement (CSS var name, class name, etc.)" }
      }
    }
  }
}
```

### `utilities.schema.json` (v1.0.0)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Design System Utilities Manifest",
  "type": "object",
  "required": ["schemaVersion", "categories"],
  "properties": {
    "$schema": { "type": "string" },
    "schemaVersion": { "type": "string", "const": "1.0.0" },
    "generatedAt": { "type": "string", "format": "date-time" },
    "categories": {
      "type": "array",
      "items": { "$ref": "#/definitions/Category" }
    }
  },
  "definitions": {
    "Category": {
      "type": "object",
      "required": ["name", "classes"],
      "properties": {
        "name": { "type": "string", "description": "Human-readable category name" },
        "description": { "type": "string" },
        "prefix": { "type": "string", "description": "Common class prefix for this category" },
        "classes": {
          "type": "array",
          "items": { "$ref": "#/definitions/UtilityClass" }
        }
      }
    },
    "UtilityClass": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": { "type": "string", "description": "Full CSS class name (e.g. lf-text-heading-1)" },
        "description": { "type": "string" },
        "properties": {
          "type": "object",
          "description": "CSS properties this class sets",
          "additionalProperties": { "type": "string" }
        },
        "tokens": {
          "type": "array",
          "description": "CSS variables referenced by this class",
          "items": { "type": "string" }
        },
        "deprecated": {
          "oneOf": [
            { "type": "null" },
            { "$ref": "#/definitions/Deprecated" }
          ]
        }
      }
    },
    "Deprecated": {
      "type": "object",
      "required": ["message"],
      "properties": {
        "message": { "type": "string" },
        "removal": { "type": "string" },
        "replacement": { "type": "string" }
      }
    }
  }
}
```

---

## 9. Migration Path

### Current → Proposed

| Manifest | Current | Change needed |
|----------|---------|---------------|
| CEM | `deprecated: string, removal: string` as siblings | Add `replacement` sibling + `deprecatedValues[]` — **backward compatible** |
| Tokens | `deprecated: true, deprecationMessage: string, removal: string` (flat) | Fold into `deprecated: { message, removal, replacement }` — **breaking, bump schema version** |
| Utilities | No deprecation support | Add `deprecated` field to classes — **additive** |

### Token build pipeline changes
1. Update `viewer-tokens.js` to parse `[DEPRECATED ...]` from `$description` field
2. Optionally: read from `$extensions[*]` as secondary source (for hand-authored tokens)
3. Optionally: merge `deprecated-tokens.json` overlay for `replacement` info
4. Emit structured `deprecated` object in parsed output
5. Bump schema version to `1.0.0`

### Utility build pipeline changes
1. Update `build-utilities-manifest.mjs` to parse `@deprecated` / `@removal` / `@replacement` from CSS comments
2. Add `deprecated` object to class entries
3. Add `$schema` and `schemaVersion` to manifest
4. Optionally: extract `properties` (CSS declarations) per class

### CEM pipeline changes
1. Already handles `@deprecated` and `@removal` in JSDoc
2. Add `@deprecatedValue` tag support → emits `deprecatedValues[]` array
3. Add `@replacement` tag support → emits `replacement` field
4. When `@deprecatedValue` is present, do NOT set `deprecated` on the attribute itself

---

## 10. Open Questions

1. **Should `replacement` be a single string or an array?**
   - Single: simpler, covers 95% of cases
   - Array: handles "split into two tokens" scenarios
   - **Recommendation**: Start with single string, extend later if needed

2. **Should utilities include `properties` (CSS output)?**
   - Pro: enables hover to show what the class does
   - Con: increases manifest size, coupling
   - **Recommendation**: Yes — it's the most useful hover info for utility classes

3. **Should we publish a generic `@design-system/manifest-schemas` npm package?**
   - This would make the LSP truly generic — any design system can adopt
   - The schemas wouldn't be LFDS-specific
   - **Recommendation**: Yes, publish as `@ADS/manifest-schemas` or similar (where ADS = "Any Design System")

4. **Token visibility filtering — should the LSP only suggest "public" tokens?**
   - Component-scoped tokens (visibility.isComponent) shouldn't appear in global `var()` completions
   - Primitive tokens are internal aliases
   - **Recommendation**: Filter by `visibility` — only show tokens where `isComponent === false && isPrimitive === false`

5. **Schema versioning strategy**
   - Use schemaVersion in the manifest file
   - The LSP should handle multiple versions gracefully (parser per version)
   - Breaking changes = major version bump
   - Additive fields = minor version bump

---

## 11. Summary

| Decision | Choice |
|----------|--------|
| Component schema | CEM (standard) + `removal`, `replacement`, `status` extensions |
| Token schema | Custom `parsed-tokens` v1.0.0 with structured `deprecated` object |
| Utility schema | New `utilities` v1.0.0 with `deprecated`, `properties`, `tokens` |
| Deprecation shape | `{ message, removal?, replacement? }` — unified across all three |
| Source authoring | JSDoc tags (components), `$extensions` (tokens), CSS comments (utilities) |
| Schema hosting | `ds.magnus.dev/schemas/v1/` + npm package + bundled in LSP |
| Discovery | `package.json` fields (`customElements` + `designSystem.*`) |
| Generic reuse | Schemas are design-system-agnostic, namespace via `$schema` URL |

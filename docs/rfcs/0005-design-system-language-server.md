# RFC 0005: Design System Language Server

**Status:** Draft
**Date:** 2026-05-06
**Author:** Magnus Fredlundh

---

## Summary

Build a generic **Design System Language Server** (DSLS) that discovers and reads existing design system files — Custom Elements Manifest, token manifests, and utility class manifests — and provides unified IntelliSense with first-class support for deprecation, removal dates, status lifecycle, and replacements.

The language server is editor-agnostic (LSP). The first delivery target is a **Zed extension**, followed by VS Code and JetBrains.

**Key principle:** The LSP adapts to design system files that already exist. No new unified manifest format. Design systems keep their existing build pipelines and file formats — the LSP reads them all and merges the data internally.

---

## Motivation

Design systems ship rich metadata — components with attributes, design tokens with resolved values, utility classes with descriptions. But no single tool provides unified IDE support across all three, and _none_ surface lifecycle information (deprecated? when is it removed? what replaces it?).

### The current landscape

| Tool | Components | Tokens | Utilities | Deprecation | Removal date |
|------|-----------|--------|-----------|-------------|--------------|
| wc-language-server | ✅ | ❌ | ❌ | ✅ (partial) | ❌ |
| css-variable-lsp | ❌ | ✅ | ❌ | ❌ | ❌ |
| Tailwind CSS LSP | ❌ | ❌ | ✅ (Tailwind only) | ❌ | ❌ |
| VS Code CSS Custom Data | ❌ | ✅ (no `var()`) | ❌ | ❌ | ❌ |
| JetBrains web-types | ❌ | ✅ | ❌ | ❌ | ❌ |

Every design system team ends up generating multiple IDE support files (`css-data.json`, `web-types.json`, `html-custom-data.json`) — each format covering a slice, none covering everything, and all missing lifecycle data.

### What we want

Existing files → one language server → every editor.

A developer using a design system should:

1. **Discover** — autocomplete for `<ds-button>`, `var(--ds-spacing-lg)`, `class="ds-text-heading-1"`
2. **Understand** — hover shows description, type, default value, resolved token values
3. **Stay current** — deprecated items show ~~strikethrough~~, hover shows what to use instead and when it's removed
4. **Get warned** — diagnostics flag usage of deprecated tokens/classes/attributes with severity based on how close the removal date is

---

## Proposal

### Architecture overview

```
node_modules/@acme/components/              node_modules/@acme/css/
├── package.json                             ├── package.json
│   "customElements": "dist/cem.json"        │   "designSystem": {
│                                            │     "tokens": "dist/tokens.json",
└── dist/                                    │     "utilities": "dist/utilities.json"
    └── custom-elements.json  (CEM)          │   }
                                             └── dist/
                                                 ├── tokens.json
                                                 └── utilities.manifest.json
            │                                            │
            └──────────────┬─────────────────────────────┘
                           ▼
          ┌──────────────────────────────────────────┐
          │     Design System Language Server         │
          │                                          │
          │  1. Scans node_modules for:              │
          │     • "customElements" → reads CEM       │
          │     • "designSystem.tokens" → reads      │
          │     • "designSystem.utilities" → reads   │
          │  2. Optionally reads ds.config.js         │
          │  3. Merges data internally                │
          │  4. Provides LSP capabilities             │
          └──────────────┬───────────────────────────┘
                         │ LSP (stdio)
           ┌─────────────┼─────────────────┐
           ▼             ▼                 ▼
      ┌────────┐   ┌──────────┐    ┌────────────┐
      │  Zed   │   │ VS Code  │    │ JetBrains  │
      │  ext   │   │   ext    │    │  plugin    │
      └────────┘   └──────────┘    └────────────┘
```

### Three deliverables

1. **Lifecycle field conventions** — documented fields (`deprecated`, `removal`, `replacement`, `status`) that design systems add to their existing manifests
2. **`ds-language-server`** — LSP implementation that reads CEM, token manifests, and utility manifests natively
3. **Editor extensions** — thin wrappers that download and start the language server

---

## 1. Supported File Formats

The LSP does **not** define a new manifest format. Instead, it reads existing formats and understands a shared set of **lifecycle fields** that can be added to any of them.

### 1.1 Lifecycle fields (shared across all formats)

These optional fields can appear on any entry in any supported format. They are what make the DS Language Server different from existing tools:

| Field | Type | Description |
|---|---|---|
| `status` | `"draft" \| "beta" \| "ready" \| "deprecated"` | Lifecycle stage of the item |
| `deprecated` | `boolean \| string` | Whether this item is deprecated. String value is the deprecation message. |
| `deprecationMessage` | `string` | Human-readable reason + migration guidance (used when `deprecated` is `boolean`) |
| `removal` | `string` | ISO date (`2026-07-30`) or semver version (`v4.0.0`) when it will be removed |
| `replacement` | `string` | Name of the replacement item (token name, class name, attribute value) |

These fields follow existing conventions — CEM already supports `deprecated: boolean | string`, LFDS already uses `removal` and `status` as custom CEM fields. The LSP simply reads them.

### 1.2 Components — Custom Elements Manifest (CEM)

**Format:** [Custom Elements Manifest v1.0.0](https://github.com/webcomponents/custom-elements-manifest)

**Discovery:** The LSP scans `node_modules/*/package.json` and `node_modules/@*/*/package.json` for the standard `"customElements"` field:

```jsonc
// package.json
{
  "customElements": "dist/lit/custom-elements.json"
}
```

This is already a standard field — wc-language-server, Storybook, and other tools use it. Zero changes needed for existing design systems.

**What the LSP reads from each CEM declaration:**

```jsonc
{
  "kind": "class",
  "name": "LfdsButton",
  "tagName": "lfds-button",
  "description": "A button or link component.",

  // Standard CEM fields
  "attributes": [
    {
      "name": "variant",
      "type": { "text": "string" },
      "default": "primary",
      "description": "Visual variant of the button.",
      "fieldName": "variant",

      // Lifecycle fields (already supported by CEM spec for deprecated)
      "deprecated": "The `tertiary` variant is removed. Use `secondary` instead.",
      "removal": "2026-07-30",            // ← custom field, LSP reads it
      "replacement": "secondary",          // ← custom field, LSP reads it
      "enum": ["primary", "secondary", "tertiary"]
    }
  ],

  "slots": [...],
  "events": [...],
  "cssProperties": [...],
  "cssParts": [...],

  // Lifecycle fields on the component itself
  "status": { "name": "ready" },          // ← custom field (LFDS format)
  "deprecated": false
}
```

**CEM fields the LSP uses:**

| CEM field | LSP usage |
|---|---|
| `tagName` | Tag completions |
| `description` | Hover docs |
| `attributes[].name` | Attribute completions |
| `attributes[].type` | Hover type info |
| `attributes[].default` | Hover + value completions |
| `attributes[].enum` | Attribute value completions |
| `attributes[].deprecated` | ~~Strikethrough~~ + diagnostics |
| `attributes[].removal` | Time-aware diagnostics |
| `attributes[].replacement` | Code actions |
| `members[]` | Property completions (Lit `.prop=` bindings) |
| `slots[]` | Hover slot docs |
| `events[]` | Event completions (`@event` bindings) |
| `cssProperties[]` | CSS variable completions (component-scoped) |
| `cssParts[]` | `::part()` completions |
| `status` | Status badge in completions/hover |

**Deprecated attribute values** are detected by cross-referencing `deprecated` on a member with its `enum` values. When a member has `deprecated: "The tertiary variant..."` and `enum: ["primary", "secondary", "tertiary"]`, the LSP infers that `tertiary` is the deprecated value. Alternatively, the CEM can include a `deprecatedValues` array for explicit value-level deprecation:

```jsonc
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

### 1.3 Design Tokens — Token Manifest

**Format:** Flexible — the LSP supports any JSON structure that contains token entries with a `cssVariable` field.

**Discovery:** The LSP looks for `"designSystem".tokens` in `package.json`:

```jsonc
// package.json
{
  "designSystem": {
    "tokens": "dist/viewer/lfds-tokens.json"
  }
}
```

**Minimum required fields per token:**

```jsonc
{
  "cssVariable": "--lfds-spacing-lg"        // Required: the CSS variable name
}
```

**Full token entry (all optional fields):**

```jsonc
{
  "cssVariable": "--lfds-spacing-lg",         // Required
  "description": "Large spacing unit.",        // Hover docs
  "group": "Spacing",                          // Category grouping in completions
  "category": "Scale",                         // Subcategory
  "type": "dimension",                         // CSS syntax hint (<length>, <color>, etc.)
  "resolved": {                                // Resolved values per mode
    "base": "24px",
    "light": "24px",
    "dark": "24px"
  },

  // Lifecycle fields
  "status": "ready",
  "deprecated": false,
  "deprecationMessage": "Use --lfds-spacing-xl instead.",
  "removal": "2026-07-30",
  "replacement": "--lfds-spacing-xl",

  // Ignored by LSP (passthrough — other tools may use these)
  "id": "lg",
  "path": ["lg"],
  "sourceFiles": ["Spacing.tokens.json"],
  "modes": { "base": "{spacing.24}" },
  "aliasChain": "24px",
  "visibility": { "isComponent": false },
  "metadata": { ... }
}
```

**Token array detection:** The LSP auto-detects the structure:

- **Flat array** — `[{ cssVariable, ... }, ...]` → reads directly
- **Object with `tokens` key** — `{ tokens: [...] }` → reads `.tokens` array (LFDS format)
- **Nested object (W3C DTCG-like)** — walks the tree looking for entries with `$value` and maps them to CSS variables using `$extensions.cssVariable` or name derivation

This means the LSP works out of the box with LFDS's `lfds-tokens.json` without any transformation.

### 1.4 Utility Classes — Utility Manifest

**Format:** Flexible — the LSP supports categorized or flat utility class arrays.

**Discovery:** The LSP looks for `"designSystem".utilities` in `package.json`:

```jsonc
// package.json
{
  "designSystem": {
    "utilities": "dist/utilities.manifest.json"
  }
}
```

**Categorized format (LFDS's current format):**

```jsonc
{
  "categories": [
    {
      "name": "Text Style – Heading",
      "prefix": "lf-text-",
      "classes": [
        {
          "name": "lf-text-heading-1",
          "description": "Typography style heading level-1.",

          // Lifecycle fields (optional — add when needed)
          "status": "ready",
          "deprecated": false
        }
      ]
    }
  ]
}
```

**Flat format (alternative):**

```jsonc
[
  {
    "name": "lf-text-heading-1",
    "description": "Typography style heading level-1.",
    "category": "typography"
  }
]
```

The LSP handles both. Like tokens, existing utility manifests work without changes — lifecycle fields are additive.

### 1.5 Discovery summary

The LSP scans `node_modules` and finds design system files through `package.json` fields:

| `package.json` field | File type | Standard? |
|---|---|---|
| `"customElements"` | Custom Elements Manifest | ✅ Existing standard (CEM spec) |
| `"designSystem".tokens` | Token manifest | New convention |
| `"designSystem".utilities` | Utility class manifest | New convention |

**Zero-config for components** — any package that already has `"customElements"` in its `package.json` works automatically.

**Minimal config for tokens/utilities** — design systems add `"designSystem"` to their `package.json` and point to existing files.

For packages that ship everything together:

```jsonc
// @acme/design-system/package.json
{
  "customElements": "dist/custom-elements.json",
  "designSystem": {
    "tokens": "dist/tokens.json",
    "utilities": "dist/utilities.json"
  }
}
```

For LFDS where it's split across packages:

```jsonc
// @lansforsakringar/core-components/package.json
{
  "customElements": "dist/lit/custom-elements.json"
  // Already exists — no changes needed
}
```

```jsonc
// @lansforsakringar/core-css/package.json
{
  "designSystem": {
    "tokens": "dist/viewer/lfds-tokens.json",
    "utilities": "dist/utilities.manifest.json"
  }
}
```

---

## 2. Language Server Capabilities

### 2.1 Completions (`textDocument/completion`)

#### HTML tag completions

Trigger: `<` in HTML/JSX/Lit templates

```html
<lfds-  →  autocomplete shows:
  lfds-button      Custom Element — ready
  lfds-alert       Custom Element — ready
  lfds-input       Custom Element — draft
  ̶l̶f̶d̶s̶-̶l̶e̶g̶a̶c̶y̶     Custom Element — deprecated (strikethrough)
```

- `CompletionItemTag.Deprecated` set on deprecated components → ~~strikethrough~~
- `detail` shows status badge
- `documentation` shows description + deprecation info

#### HTML attribute completions

Trigger: space inside a custom element tag

```html
<lfds-button | →  autocomplete shows:
  variant      string — "primary" | "secondary"
  size         string — "large" | "small"
  ̶l̶a̶b̶e̶l̶        string — ⚠ deprecated (strikethrough)
  disabled     boolean
  href         string
```

#### HTML attribute value completions

Trigger: `="` after an attribute name

```html
<lfds-button variant="| →  autocomplete shows:
  primary      (default)
  secondary
  ̶t̶e̶r̶t̶i̶a̶r̶y̶      ⚠ deprecated — Use `secondary` instead (strikethrough)
```

#### CSS variable completions

Trigger: `var(` or `--` in CSS/SCSS/Lit `css` templates

```css
color: var(--lfds- →  autocomplete shows:
  --lfds-spacing-lg                 24px — Spacing
  --lfds-color-text-primary         #1a1a1a — Color
  ̶-̶-̶l̶f̶d̶s̶-̶c̶o̶l̶o̶r̶-̶b̶g̶-̶b̶u̶t̶t̶o̶n̶-̶p̶r̶i̶m̶a̶r̶y̶-̶p̶r̶e̶s̶s̶e̶d̶  ⚠ deprecated (strikethrough)
```

The LSP merges tokens from the token manifest with component-scoped `cssProperties` from the CEM. Component CSS properties (e.g., `--lfds--button-background-color`) appear when editing CSS that targets that component.

#### Utility class completions

Trigger: `class="` or `className="` in HTML/JSX, Lit `classMap`, or relevant template syntax

```html
<div class="lf- →  autocomplete shows:
  lf-text-heading-1     Typography style heading level-1
  lf-text-body-default  Typography style body default
  lf-bg-primary         Primary background color
  lf-sr-only            Visually hidden, accessible to screen readers
```

### 2.2 Hover (`textDocument/hover`)

Rich markdown hover documentation for all design system symbols.

#### Token hover

```
--lfds-spacing-lg

Large spacing unit.

Value: 24px
Category: Spacing
Status: ready
```

#### Deprecated token hover

```
⚠️ DEPRECATED — --lfds-color-background-button-primary-pressed

Use `--lfds-color-interactive-primary-pressed` instead.

Removal: 2026-07-30 (in 85 days)
Replacement: --lfds-color-interactive-primary-pressed

───

Primary button pressed background.

Value: #00427a (light) · #52a8e1 (dark)
Category: Color
```

#### Component hover

```
<lfds-button>

A button or link component.

Status: ready
Package: @lansforsakringar/core-components

Slots: default, start, end
Attributes: variant, size, disabled, href
```

#### Deprecated attribute value hover

```
⚠️ DEPRECATED VALUE — variant="tertiary"

Use `secondary` instead.
Removal: 2026-07-30 (in 85 days)
```

### 2.3 Diagnostics (`textDocument/publishDiagnostics`)

The LSP publishes diagnostics for deprecated usage with **time-aware severity**:

| Condition | Severity | Example |
|---|---|---|
| Deprecated, removal > 90 days away | `Information` | ℹ️ `--lfds-color-bg-pressed` is deprecated. Use `--lfds-color-interactive-pressed`. Removal: 2026-07-30. |
| Deprecated, removal 30–90 days away | `Warning` | ⚠️ `--lfds-color-bg-pressed` is deprecated and will be removed in 62 days. Use `--lfds-color-interactive-pressed`. |
| Deprecated, removal < 30 days away | `Error` | 🔴 `--lfds-color-bg-pressed` will be removed on 2026-07-30 (in 12 days!). Replace with `--lfds-color-interactive-pressed`. |
| Deprecated, removal date passed | `Error` | 🔴 `--lfds-color-bg-pressed` was scheduled for removal on 2026-04-01. It may stop working in the next update. |
| Deprecated, no removal date | `Warning` | ⚠️ `--lfds-color-bg-pressed` is deprecated. Use `--lfds-color-interactive-pressed`. |
| Using `draft` component | `Information` | ℹ️ `<lfds-heading>` is in draft status. API may change. |
| Using deprecated attribute value | `Warning` | ⚠️ `variant="tertiary"` is deprecated. Use `secondary` instead. |

This is the killer feature — **urgency increases as the removal date approaches**. Developers see informational hints early, then warnings, then errors. No surprises.

### 2.4 Code Actions (`textDocument/codeAction`)

When a `replacement` is specified, the LSP offers quick-fix code actions:

```
⚠️ variant="tertiary" is deprecated. Use `secondary` instead.

  Quick Fix: Replace `tertiary` with `secondary`     ← one click
```

```
⚠️ --lfds-color-bg-pressed is deprecated.

  Quick Fix: Replace with `--lfds-color-interactive-pressed`
```

---

## 3. Configuration: `ds.config.js`

Consumers can override default behavior with an optional `ds.config.js` (or `ds.config.json`) in the workspace root:

```js
// ds.config.js
export default {
  /**
   * Override auto-discovery with explicit file paths.
   * Useful for monorepos or non-npm setups.
   */
  sources: {
    components: [
      "node_modules/@lansforsakringar/core-components/dist/lit/custom-elements.json"
    ],
    tokens: [
      "node_modules/@lansforsakringar/core-css/dist/viewer/lfds-tokens.json"
    ],
    utilities: [
      "node_modules/@lansforsakringar/core-css/dist/utilities.manifest.json"
    ]
  },

  /** Diagnostic severity overrides */
  diagnostics: {
    /** Global severity for deprecated items (default: "auto" — based on removal date) */
    deprecated: "auto",

    /** Severity for draft component usage (default: "information") */
    draftUsage: "information",

    /** Per-package overrides */
    packages: {
      "@old/legacy-ds": {
        deprecated: "error"   // Stricter for package you're migrating away from
      }
    }
  },

  /** File types where the LSP activates */
  languages: ["html", "css", "scss", "javascript", "typescript", "vue", "svelte"],

  /** Tagged template literals to analyze (in JS/TS files) */
  templateTags: {
    html: ["html", "htm"],        // Lit, etc.
    css: ["css"]                  // Lit css template tag
  },

  /** HTML attributes where utility class completions should trigger */
  classAttributes: ["class", "className"],
}
```

---

## 4. Editor Extensions

### Zed extension (first target)

```
ds-language-server-zed/
├── extension.toml
├── Cargo.toml
├── src/
│   └── lib.rs            # Downloads + starts ds-language-server binary
└── languages/            # (empty — no grammar, only LSP)
```

**`extension.toml`:**
```toml
id = "ds-language-server"
name = "Design System Language Server"
description = "IntelliSense for design tokens, components, and utility classes."
version = "0.1.0"
schema_version = 1
authors = ["Magnus Fredlundh"]
repository = "https://github.com/example/ds-language-server"

[language_servers.ds-language-server]
languages = ["HTML", "CSS", "JavaScript", "TypeScript"]
```

**`src/lib.rs`:** Downloads the pre-built `ds-language-server` binary from GitHub Releases (platform-specific: macOS arm64/x64, Linux x64/arm64), caches it, and returns the command to Zed.

**Consumer setup in Zed:**

1. Install the extension from Zed's marketplace
2. Done — auto-discovery finds manifests from `node_modules`

Optional override in `.zed/settings.json`:

```json
{
  "lsp": {
    "ds-language-server": {
      "settings": {
        "sources": {
          "tokens": ["node_modules/@acme/tokens/dist/tokens.json"]
        },
        "diagnostics": {
          "deprecated": "warning"
        }
      }
    }
  }
}
```

### VS Code extension (later)

Standard VS Code language client wrapping the same `ds-language-server` binary.

### JetBrains plugin (later)

LSP client plugin. Design systems that also generate `web-types.json` get basic support for free — the LSP adds lifecycle features on top.

---

## 5. What Changes for LFDS

The key benefit of this approach: **almost nothing changes in the build pipeline.**

### Changes needed

| Package | Change | Effort |
|---|---|---|
| `core-components` | None — already has `"customElements"` in `package.json` | Zero |
| `core-components` | Already has `deprecated`, `removal`, `status` in CEM | Zero |
| `core-css` | Add `"designSystem"` field to `package.json` pointing to existing files | 2 lines |
| `core-css` | Add lifecycle fields (`deprecated`, `removal`, `status`) to `utilities.manifest.json` when deprecating utilities | Per-item, when needed |
| `core-tokens` | Add lifecycle fields to `lfds-tokens.json` when deprecating tokens | Per-item, when needed |

### `core-css/package.json` — the only structural change

```jsonc
{
  "name": "@lansforsakringar/core-css",
  // ... existing fields ...
  "designSystem": {
    "tokens": "dist/viewer/lfds-tokens.json",
    "utilities": "dist/utilities.manifest.json"
  }
}
```

### What stays the same

- `custom-elements.json` generation — unchanged
- `lfds-tokens.json` generation — unchanged
- `utilities.manifest.json` generation — unchanged
- `lfds.css-data.json`, `web-types.json`, `vscode.html-custom-data.json` — keep generating as fallback for users without the extension
- TypeScript types (`classes.d.ts`, `css-variables.d.ts`) — unchanged, these serve a different purpose

---

## 6. What This Replaces

For consumers who install the DSLS extension, it **replaces**:

| Current tool | Replaced by |
|---|---|
| CSS Variables extension (Zed/VS Code) | DSLS (token completions with lifecycle info) |
| wc-language-server | DSLS (component completions with lifecycle info) |
| HTML CSS Support extension | DSLS (utility class completions) |

Current fallback files (`lfds.css-data.json`, `web-types.json`, `vscode.html-custom-data.json`) continue to be generated for users who haven't installed the extension. But the DSLS provides the richer experience — lifecycle-aware diagnostics, code actions, and unified hover docs.

---

## 7. Scope & Phasing

### Phase 1: Foundation

- [ ] Document lifecycle field conventions for CEM, tokens, utilities
- [ ] Add `"designSystem"` to `core-css/package.json` (points to existing files)
- [ ] Validate that existing LFDS data (CEM + tokens + utilities) covers all LSP needs
- [ ] Add lifecycle fields to token and utility manifests in the build pipeline

### Phase 2: Language server MVP

- [ ] TypeScript LSP implementation using `vscode-languageserver`
- [ ] File discovery (scan `node_modules` for `"customElements"` and `"designSystem"`)
- [ ] CEM parser → component tag/attribute completions
- [ ] Token manifest parser → CSS `var()` completions
- [ ] Utility manifest parser → `class=""` completions
- [ ] Hover documentation for all three
- [ ] Deprecation: ~~strikethrough~~ in completions, ⚠️ in hover

### Phase 3: Zed extension + diagnostics

- [ ] Build Zed extension (Rust WASM wrapper that downloads the LSP binary)
- [ ] Publish to Zed marketplace
- [ ] Time-aware deprecation diagnostics (info → warning → error)
- [ ] Code actions for replacements
- [ ] `ds.config.js` support
- [ ] File watching (reload when manifests change)

### Phase 4: VS Code extension + ecosystem

- [ ] VS Code extension
- [ ] Documentation site
- [ ] Published as open-source packages
- [ ] Test with other design systems (Shoelace, Spectrum, etc.) to validate genericity

---

## 8. Open Questions

1. **Naming** — `ds-language-server`? `design-system-lsp`? `dsls`? Needs a name that's clear and discoverable in extension marketplaces.

2. **Lit template support** — Analyzing `html\`<lfds-button>\`` and `css\`var(--lfds-*)\`` inside tagged template literals requires understanding JS/TS context. Use volar? Regex-based extraction? Scope for v1 or later?

3. **Framework template support** — Vue `<template>`, Svelte templates, Angular templates, JSX. Which frameworks in v1?

4. **Runtime implementation language** — TypeScript (faster to build, leverage `vscode-html-languageservice`) vs Rust (no Node dependency, faster startup). Current proposal: TypeScript, distributed as self-contained binary via `pkg` or Node SEA (Single Executable Application).

5. **Coexistence with existing extensions** — If a user has both `wc-language-server` and the DSLS installed, they'll get duplicate component completions. Options: (a) document that DSLS replaces wc-ls, (b) detect and defer, (c) make it configurable which sources to handle.

6. **Token manifest format diversity** — LFDS uses `lfds-tokens.json` with a `tokens[]` array and `cssVariable` field. Other design systems may use W3C DTCG format, Style Dictionary output, or custom structures. How many formats to support in v1? Start with "array of objects with `cssVariable`" + auto-detect common structures.

7. **Upstream contribution** — Should we contribute `removal`/`replacement`/`status` field support to the CEM spec? And/or to `wc-language-server`? Would strengthen the ecosystem even if we build our own LSP.

8. **Schema governance** — If `"designSystem"` in `package.json` becomes a convention used by multiple design systems, should it be formalized via a spec or community group?

9. **Performance at scale** — LFDS has ~20 components, ~340 tokens, ~44 utilities. Large design systems (Material, Carbon) could have 100+ components and 1000+ tokens. Need to validate that manifest parsing and completion generation stay fast.

10. **File watching** — Should the LSP watch manifest files for changes and hot-reload? Important for monorepo development where the design system is a local dependency being actively developed.

---

## 9. Prior Art

| Project | Scope | Approach |
|---|---|---|
| [wc-language-server](https://github.com/wc-toolkit/wc-language-server) | Web Components | LSP reading CEM. Solid deprecation support for components. No tokens/utilities. |
| [css-variable-lsp](https://crates.io/crates/css-variable-lsp) | CSS Variables | Rust LSP scanning CSS files. No deprecation, no manifest awareness. |
| [Tailwind CSS LSP](https://github.com/tailwindlabs/tailwindcss-intellisense) | Utility classes | Deep Tailwind integration. Not usable for custom design systems. |
| [Style Dictionary](https://amzn.github.io/style-dictionary/) | Tokens | Build tool. Generates multiple output formats but no LSP. |
| [Cobalt UI](https://cobalt-ui.pages.dev/) | Tokens | W3C DTCG tooling. No LSP. |
| [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest) | Components | Schema spec. No LSP, limited lifecycle fields. |

None combine all three (tokens + utilities + components) with lifecycle-aware IDE tooling. The DSLS fills this gap by reading what already exists rather than requiring a new format.

---

## 10. Alternatives Considered

### A: Create a single unified `ds-manifest.json` format

**Pro:** One file, one parser, simpler LSP.
**Con:** Forces every design system to build a new generator that merges CEM + tokens + utilities into a custom format. Duplicates data that already exists. High adoption barrier — design systems must learn and generate a new format.
**Verdict:** Rejected. The LSP should adapt to design systems, not the other way around. Design systems already have build pipelines that generate CEM, tokens, and utility files. Adding a merge step is unnecessary work.

### B: Extend wc-language-server with token/utility support

**Pro:** Existing project, established community, already handles CEM.
**Con:** Different scope and vision. Adding tokens and utilities to a "Web Components" tool would be scope creep. The maintainers may not want to take on design system concerns.
**Verdict:** Better as a new project that can reference wc-ls for inspiration.

### C: Build a VS Code extension first (not LSP)

**Pro:** Larger market, VS Code-specific APIs (CodeLens, color decorations).
**Con:** VS Code-only. Would need to be rebuilt for Zed, JetBrains. The LSP approach gives us all editors from a single implementation.
**Verdict:** LSP is the right abstraction. Editor extensions are thin wrappers.

### D: Generate richer existing formats instead (CSS Custom Data, web-types, CEM)

**Pro:** No new server to build or maintain.
**Con:** Existing formats don't support lifecycle data. Multiple files per editor. No diagnostics, no code actions, no time-aware deprecation warnings.
**Verdict:** This is what we do today. It covers basic autocomplete but misses the lifecycle story entirely.

### E: Embed everything in the CEM using custom fields

**Pro:** One format, CEM already has community adoption.
**Con:** CEM is for components. Putting tokens and utility classes in CEM is a misuse of the format. Custom fields aren't guaranteed to be preserved by CEM tools.
**Verdict:** CEM should remain component-focused. The LSP reads CEM _for components_ and separate files for tokens/utilities.

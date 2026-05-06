# DS Foundation

> A generic Language Server for design systems — IntelliSense for components, tokens, and utility classes with lifecycle-aware deprecation diagnostics.

**Any design system can use it.** Point to your manifests, get completions + deprecation warnings in your editor.

---

## What it does

A single Language Server that reads your design system manifests and provides:

- **Component completions** — tag names, attributes, attribute values, slots (from [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest))
- **Token completions** — CSS `var()` autocomplete with resolved values (from your token manifest)
- **Utility class completions** — `class=""` / `className=""` autocomplete with descriptions (from your utility manifest)
- **Deprecation diagnostics** — ~~strikethrough~~ on deprecated items, time-aware severity escalation
- **Code actions** — one-click replacements for deprecated tokens, attribute values, and classes
- **Value-level deprecation** — flag specific attribute values without marking the whole attribute

### Time-aware diagnostics

Diagnostic severity **escalates as the removal date approaches**:

| Removal date | Severity |
|---|---|
| > 90 days away | ℹ️ Information |
| 30–90 days away | ⚠️ Warning |
| < 30 days away | 🔴 Error |
| Past due | 🔴 Error |

---

## Setup

### For design system authors

Add discovery fields to your published `package.json`:

```json
{
  "name": "@your-org/design-system",
  "customElements": "dist/custom-elements.json",
  "designSystem": {
    "tokens": "dist/tokens.json",
    "utilities": "dist/utilities.manifest.json"
  }
}
```

The LSP discovers these automatically when your package is in a consumer's `node_modules`.

### For monorepos / local development

Create a `ds.config.json` in the workspace root:

```json
{
  "sources": {
    "components": ["packages/components/dist/custom-elements.json"],
    "tokens": ["packages/tokens/dist/tokens.json"],
    "utilities": ["packages/css/dist/utilities.manifest.json"]
  }
}
```

This is useful when developing the design system itself (packages are local, not in `node_modules`).

### For consumers

Install the editor extension and open a project that depends on a design system package with the fields above. Auto-discovery handles the rest — no config needed.

---

## Supported manifest formats

| Format | Used for | Discovery |
|---|---|---|
| [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest) | Components | `"customElements"` in package.json |
| Token JSON (structured, flat array, or W3C DTCG) | Design tokens | `"designSystem".tokens` in package.json |
| Utility manifest (categorized or flat) | CSS utility classes | `"designSystem".utilities` in package.json |

### Deprecation in manifests

**Structured format (recommended):**
```json
{
  "deprecated": {
    "message": "Use --ds-color-primary-pressed instead.",
    "removal": "2026-07-30",
    "replacement": "--ds-color-primary-pressed"
  }
}
```

**Flat format (also supported):**
```json
{
  "deprecated": true,
  "deprecationMessage": "Use X instead.",
  "removal": "2026-07-30",
  "replacement": "--new-token-name"
}
```

**Value-level deprecation** (CEM — deprecate specific values without deprecating the attribute):
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

---

## Schemas

JSON schemas for manifest validation:

```
https://ds.foundation/schemas/v1/tokens.json
https://ds.foundation/schemas/v1/utilities.json
https://ds.foundation/schemas/v1/cem-extensions.json
```

Add `$schema` to your manifests for IDE validation:
```json
{
  "$schema": "https://ds.foundation/schemas/v1/tokens.json",
  "schemaVersion": "1.0.0",
  "tokens": [...]
}
```

---

## Editor support

### VS Code

See [`editors/vscode/SETUP.md`](editors/vscode/SETUP.md) for installation.

```bash
cd editors/vscode
npm install
npm run bundle-server
npx vsce package --allow-missing-repository
code --install-extension ds-language-server-0.1.0.vsix
```

### Zed

See [`editors/zed/SETUP.md`](editors/zed/SETUP.md) for installation.

Requires the Zed extension (registers the LSP for file types) + the server built locally.

---

## Development

```bash
npm install
npm run build    # tsc → dist/
npm test         # vitest (46 tests)
```

### Run the server

```bash
node dist/server.js --stdio
```

### Build VS Code extension

```bash
cd editors/vscode
npm install
npm run bundle-server   # esbuild → server/server.js (single 199KB bundle)
```

---

## Architecture

```
src/
├── server.ts              # LSP entry point
├── types.ts               # Normalized internal types
├── lifecycle.ts           # Deprecation/removal date logic
├── discovery.ts           # Find manifests in node_modules or ds.config.json
├── store.ts               # Central data store with indexed lookups
├── scanner.ts             # Document analysis (cursor context + symbol scanning)
└── providers/
    ├── completion.ts      # textDocument/completion
    ├── hover.ts           # textDocument/hover
    ├── diagnostics.ts     # textDocument/publishDiagnostics
    └── code-actions.ts    # textDocument/codeAction

editors/
├── vscode/                # VS Code extension (plain JS + bundled server)
│   ├── extension.js
│   └── server/server.js   # esbuild bundle of src/server.ts
└── zed/                   # Zed extension (Rust → WASM)

packages/
└── schemas/               # JSON Schema files for manifest validation
    └── v1/
        ├── tokens.json
        ├── utilities.json
        └── cem-extensions.json
```

---

## License

MIT

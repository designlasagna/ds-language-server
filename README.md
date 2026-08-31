# @designlasagna/ds-language-server

> A local-first Language Server for design systems: IntelliSense and diagnostics for components, tokens, and utility classes.

Point the server at Custom Elements, token, and utility manifests to get completions, lifecycle diagnostics, code actions, and DTCG/schema validation.

---

## What it does

A single Language Server that reads your design system manifests and provides:

- **Component completions** — tag names, attributes, attribute values, slots (from [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest))
- **Token completions** — CSS `var()` autocomplete with resolved values (from your token manifest)
- **Utility class completions** — `class=""` / `className=""` autocomplete with descriptions (from your utility manifest)
- **Deprecation diagnostics** — native editor deprecation styling and time-aware severity escalation
- **Code actions** — one-click replacements for deprecated tokens, attribute values, and classes
- **Value-level deprecation** — flag specific attribute values without marking the whole attribute
- **Token-document schema diagnostics** — DTCG and Design Lasagna manifests are validated on open, with concise messages and JSONC ranges

### Time-aware diagnostics

Diagnostic severity **escalates as the removal date approaches**:

| Removal date | Severity |
|---|---|
| > 90 days away | Information |
| 30–90 days away | Warning |
| < 30 days away | Error |
| Past due | Error |

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

Sources are **merged** with auto-discovered manifests from `node_modules`. This means a team can use a published design system and add their own local tokens or utilities on top.

### Controlling discovery

By default the LSP scans all packages in `node_modules`. You can limit this with `discovery`:

```json
{
  "discovery": {
    "packages": ["@acme/design-system", "@acme/tokens"]
  },
  "sources": {
    "utilities": ["src/local-utilities.json"]
  }
}
```

Only the listed packages are scanned — everything else in `node_modules` is ignored. Local `sources` are still loaded alongside.

To disable auto-discovery entirely and use only explicit paths:

```json
{
  "discovery": { "enabled": false },
  "sources": {
    "components": ["path/to/custom-elements.json"],
    "tokens": ["path/to/tokens.json"]
  }
}
```

### For local consumers

The language server and its editor integrations are currently used from local checkouts. Build the server, then configure your editor with its local server path as shown below. Auto-discovery handles manifests from installed design-system packages; `ds.config.json` adds local sources.

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

JSON schemas for manifest validation are maintained in a separate repository: [`@designlasagna/schemas`](https://github.com/designlasagna/schemas)

```
https://designlasagna.recipes/v0.3/tokens.json
https://designlasagna.recipes/v0.3/utilities.json
https://designlasagna.recipes/v0.3/cem-extensions.json
https://designlasagna.recipes/v0.3/dtcg-extensions.json
```

Add `$schema` to your manifests for IDE validation:
```json
{
  "$schema": "https://designlasagna.recipes/v0.3/tokens.json",
  "schemaVersion": "0.3.0",
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
npm test         # vitest
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
```

---

## License

MIT

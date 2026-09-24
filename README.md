# @designlasagna/ds-language-server

> A local-first Language Server for design systems: IntelliSense and diagnostics for components, tokens, and utility classes.

Point the server at Custom Elements, token, and utility manifests to get completions, lifecycle diagnostics, code actions, and DTCG/schema validation.

---

## What it does

A single Language Server that reads your design system manifests and provides:

- **Component completions** — tags, attributes, values, slots, Lit properties/events, scoped CSS properties and `::part()` (from [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest))
- **Token completions** — CSS `var()` autocomplete with resolved values (from your token manifest)
- **Utility class completions** — configurable class attributes and static Lit `classMap` keys, with descriptions (from your utility manifest)
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

### Configuration and automatic reload

Configuration is loaded from the workspace root in this order: `ds.config.json`, `ds.config.js`, then `ds.config.mjs` (first existing file wins). Invalid or deleted configuration falls back to discovery defaults. JS configuration runs in the server process; only use trusted configuration files.

The server watches configuration candidates, explicit and package-declared manifest paths (including missing files and arbitrary filenames), package metadata, and shallow package directories. It refreshes watches when sources change. Clients advertising dynamic watched-file registration receive targeted registrations; otherwise, or if registration is rejected, the server polls target metadata every 750 ms. Changes are debounced for 100 ms. The fallback does not recursively scan directories on every tick.

This handles source creation, atomic replacement, deletion/recreation, and package installation without restarting. Imported JS config helpers remain cached and require a restart; config entry modules are reloaded. ESM reloads retain module-cache entries, and large-workspace polling performance has not yet been benchmarked. Live VS Code/Zed smoke testing remains separate from the automated LSP tests.

### Recognition and editor settings

`languages`, `templateTags`, `classAttributes`, and per-package deprecation severity are wired through recognition and editor transport. Explicit editor settings override project values; unset editor defaults do not. Arrays replace (including `[]`), and an empty editor snapshot resets to project settings.

See [configuration and recognition](docs/configuration-and-recognition.md) for VS Code/Zed examples, precise completion scopes, and lexical-parser limitations. Historical implementation and validation evidence is kept separately in [RFC delivery evidence](docs/rfc-0005-delivery-status.md).

### Lifecycle contract profile

The legacy lifecycle adapter remains the default. To opt CEM and DTCG sources into the v0.4 lifecycle contract, select it explicitly in `ds.config.*`:

```json
{ "lifecycle": { "profile": "0.4" } }
```

Native token and utility manifests select v0.4 automatically with `schemaVersion: "0.4.0"`; they do not require the CEM/DTCG profile setting. CEM retains its standard schema version. Token-document schema diagnostics follow the same native-version/DTCG-profile selection.

### Install the server

Install the published server when integrating it with an editor or tool:

```bash
npm install --save-dev @designlasagna/ds-language-server
```

The executable is `ds-language-server`; editor integrations configure the `--stdio` transport for you. Auto-discovery handles manifests from installed design-system packages, while `ds.config.json` adds local sources.

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
https://designlasagna.recipes/schemas/v0.3/tokens.json
https://designlasagna.recipes/schemas/v0.3/utilities.json
https://designlasagna.recipes/schemas/v0.3/cem-extensions.json
https://designlasagna.recipes/schemas/v0.3/dtcg-extensions.json
```

Add `$schema` to your manifests for IDE validation:
```json
{
  "$schema": "https://designlasagna.recipes/schemas/v0.3/tokens.json",
  "schemaVersion": "0.3.0",
  "tokens": [...]
}
```

---

## Editor support

### VS Code

Install **Design Lasagna: Design System Language Server** from the Visual Studio Marketplace, or see [`editors/vscode/SETUP.md`](editors/vscode/SETUP.md) for development installation and release guidance.

### Zed

The Zed extension installs the npm server automatically. It is ready for development installation; public registry registration is pending. See [`editors/zed/SETUP.md`](editors/zed/SETUP.md).

---

## Releases

The npm server, VS Code extension, and Zed extension use independent Semantic Versioning. Release the npm package with a `dsls-v<version>` tag that matches the root `package.json`; release the VS Code extension with a `vscode-v<version>` tag that matches `editors/vscode/package.json`. The Zed extension is versioned with its registry submission.

Editor changelogs identify the server version they bundle or install when relevant. An editor-only fix does not require a server release, and a server release does not require an editor release.

## Development

```bash
npm install
npm run build    # tsc → dist/
npm test         # vitest
```

For synthetic scale measurements, run `node scripts/benchmark.mjs` after building. [Recorded results and limitations](docs/rfc-0005-delivery-status.md) are not live-editor performance guarantees.

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

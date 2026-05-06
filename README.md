# ds-language-server

> Language Server for design systems — IntelliSense for components, tokens, and utility classes with lifecycle-aware deprecation diagnostics.

## What it does

A single Language Server that reads your existing design system files and provides:

- **Component completions** — tag names, attributes, attribute values, slots (from [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest))
- **Token completions** — CSS `var()` autocomplete with resolved values and color previews (from your token manifest)
- **Utility class completions** — `class=""` autocomplete with descriptions (from your utility manifest)
- **Deprecation warnings** — ~~strikethrough~~ on deprecated items, hover with migration guidance, time-aware diagnostics
- **Code actions** — one-click replacements for deprecated tokens, attribute values, and classes

### Time-aware diagnostics

The killer feature: diagnostic severity **escalates as the removal date approaches**.

| Removal date | Severity |
|---|---|
| > 90 days away | ℹ️ Information |
| 30–90 days away | ⚠️ Warning |
| < 30 days away | 🔴 Error |
| Past due | 🔴 Error |

## Setup

### For design system authors

Point to your existing files in `package.json`:

```json
{
  "customElements": "dist/custom-elements.json",
  "designSystem": {
    "tokens": "dist/tokens.json",
    "utilities": "dist/utilities.manifest.json"
  }
}
```

The LSP discovers these automatically from `node_modules`.

### Lifecycle fields

Add these optional fields to any item in your manifests to get deprecation support:

```json
{
  "deprecated": true,
  "deprecationMessage": "Use X instead.",
  "removal": "2026-07-30",
  "replacement": "--new-token-name"
}
```

### For consumers

Install the editor extension and open a project that depends on a design system package with the fields above. Auto-discovery handles the rest.

## Supported formats

| Format | Used for | Discovery |
|---|---|---|
| Custom Elements Manifest (CEM) | Components | `"customElements"` in package.json |
| Token JSON (LFDS format, flat array, or W3C DTCG) | Design tokens | `"designSystem".tokens` in package.json |
| Utility manifest (categorized or flat) | CSS utility classes | `"designSystem".utilities` in package.json |

## Development

```bash
npm install
npm run build
npm test
```

### Run the server

```bash
node dist/server.js --stdio
```

## Architecture

```
src/
├── server.ts              # LSP entry point
├── types.ts               # Normalized internal types
├── lifecycle.ts           # Deprecation/removal date logic
├── discovery.ts           # Find manifests in node_modules
├── store.ts               # Central data store
├── scanner.ts             # Document analysis (cursor context + symbol scanning)
└── providers/
    ├── completion.ts      # textDocument/completion
    ├── hover.ts           # textDocument/hover
    ├── diagnostics.ts     # textDocument/publishDiagnostics
    └── code-actions.ts    # textDocument/codeAction
```

## License

MIT

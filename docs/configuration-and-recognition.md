# Configuration transport and recognition

This reference describes the DSLS configuration contract published in `@designlasagna/ds-language-server` 0.2.0. Runtime behavior is covered by unit/provider and stdio LSP tests. Zed auto-install and server startup have also been smoke-tested locally; VS Code live-editor verification remains separate evidence.

## Configuration precedence

1. Built-in defaults.
2. Workspace `ds.config.json`, `.js`, or `.mjs` (first existing file in that order).
3. Explicit editor settings, restricted to the fields below.

Editor-overridable fields are `languages`, `templateTags.html`, `templateTags.css`, `classAttributes`, `diagnostics.deprecated`, and `diagnostics.packages[packageName].deprecated`. Sources, discovery, lifecycle profile, and `diagnostics.draftUsage` remain project-file settings. Explicit sources still **add to discovery** unless discovery is disabled.

Arrays replace, not concatenate. `[]` disables the corresponding recognition list. Nested settings merge per field/package. An omitted or invalid editor field falls back to the project value; an empty editor snapshot resets the entire editor layer. File reloads retain the current editor layer. Editor settings cannot alter source paths or silently opt a project into a new lifecycle contract.

The server seeds settings from initialization options (direct or `{ "dsLanguageServer": ... }`). Clients advertising `workspace.configuration: true` are queried for section `dsLanguageServer` on initialization and change; rejected requests retain the last snapshot. Other clients send a complete snapshot in `workspace/didChangeConfiguration.settings`, either directly or under that section. Old asynchronous responses cannot replace newer settings. Shutdown does not wait for an unanswered configuration request.

### VS Code

Set `dsLanguageServer.languages`, `.templateTags`, `.classAttributes`, or `.diagnostics`. Only explicitly configured values are forwarded: extension defaults cannot override project settings. Explicit object settings merge global → workspace → workspace-folder; arrays replace. The file document selector is broad, with server-side language gating, so project language settings are not silently blocked by a fixed selector. Token-manifest schema diagnostics remain independently gated by discovered token-document URIs.

### Zed

The wrapper forwards `lsp.ds-language-server.settings` as initialization options and workspace configuration:

```json
{
  "lsp": {
    "ds-language-server": {
      "settings": {
        "templateTags": { "html": ["html", "view"], "css": ["css"] },
        "diagnostics": { "packages": { "@example/legacy": { "deprecated": "error" } } }
      }
    }
  }
}
```

For local server development, use Zed's built-in `lsp.ds-language-server.binary.path` and `arguments` override rather than DSLS-specific settings. Put manifest `sources` and `lifecycle.profile` in `ds.config.*`. Zed's `extension.toml` language registration still bounds which documents reach the server; changing the server allowlist cannot register an arbitrary new Zed language. Local wrapper validation includes native checks, WASM compilation, and a dev-extension smoke test; Zed registry availability remains separate.

## Recognition

```json
{
  "languages": ["html", "css", "typescript", "typescriptreact"],
  "templateTags": { "html": ["html", "view.html"], "css": ["css"] },
  "classAttributes": ["class", "className", "utility"],
  "diagnostics": {
    "deprecated": "auto",
    "packages": { "@example/legacy": { "deprecated": "error" } }
  }
}
```

The default language IDs are `html`, `css`, `scss`, `less`, `javascript`, `typescript`, `javascriptreact`, `typescriptreact`, `vue`, `svelte`, and `astro`. These are recognition allowlists, not claims of a complete framework parser.

- In JavaScript/TypeScript documents, only static content of configured tagged templates is analyzed (`html`/`css` by default). Dotted tag names are supported. Ordinary strings/comments and interpolation expressions are masked without shifting source offsets. Nested configured templates inside expressions are analyzed; regular-expression literals are skipped lexically.
- JSX/TSX retain the existing markup/static class-template recognition. `templateTags` filtering is currently applied to the `javascript`/`typescript` language IDs, not to JSX/TSX or framework-file script sections. This is a lexical recognizer, not a full JS/JSX/framework AST.
- Default class attributes are `class`, `className`, and `classList`. Custom names are matched literally, including regex punctuation; `class` does not match `data-class`.
- Completion, hover, and lifecycle diagnostics share language/class recognition settings. Disabling language recognition does not disable schema diagnostics for a discovered token manifest.
- Per-package severity uses the entity's exact source package name; explicit local sources use `config`. Package override → global override → automatic severity. `auto`, `off`, `information`, `warning`, and `error` are supported. Explicit overrides retain the existing diagnostic policy; in automatic mode removed is always an error. Lifecycle conflict diagnostics are not disabled merely by turning deprecation severity off.

## Additional component APIs

- **Lit `.property` / `@event`:** CEM public, writable, non-static fields and declared events, including unreflected properties. Methods/private/protected/read-only fields are excluded. Insertion preserves Lit `${...}` syntax. Deprecated entries retain completion tags and guidance. Unknown components and quoted attribute values do not get member suggestions.
- **`::part()`:** parts from a single explicit custom-element selector, optionally with simple class/id/pseudo qualifiers. Selector lists, combinators, functional selectors, nesting and unknown owners are deliberately not guessed.
- **Component CSS custom properties:** merged with global token suggestions within an explicit component rule; scoped names win collisions. Global/ambiguous contexts do not receive unrelated component properties. Media wrappers are supported. Inline-style and inferred `:host` ownership are not currently resolved.
- **Lit `classMap`:** static string/identifier keys in a direct `classMap({...})` class-attribute interpolation support completion, hover, diagnostics and safe replacement ranges. Configured class attributes are respected. Values, computed keys and spreads are not inferred. Escaped keys are omitted instead of producing unsafe edits. This does not evaluate conditional values, imported aliases, arbitrary class-producing functions or JSX object-expression syntax.

Component hover stays compact. Component tag replacements remain diagnostic-only; none of these additions introduces paired-tag rename actions.

## Local verification

```sh
npm run build
npm test
node --check editors/vscode/extension.js
cargo check --offline --manifest-path editors/zed/Cargo.toml
node scripts/benchmark.mjs
```

See [RFC delivery evidence](rfc-0005-delivery-status.md) for historical measured scale data and outstanding external validation. Automated checks do not establish Marketplace or Zed registry availability, and VS Code still requires a live-editor smoke test.

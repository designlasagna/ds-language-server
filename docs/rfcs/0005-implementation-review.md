# RFC 0005 implementation review

Reviewed against commit `ea42de7`. This is an implementation audit, not a proposal to restore every original presentation detail.

## Implementation progress — 2026-09-20

The audit below is the original baseline. The first follow-up slice now centralizes JSON/JS/MJS loading across startup and reload notifications, clears stale config on deletion/load failure, protects overlapping async reloads, and decodes workspace URIs. Loader and stdio LSP tests cover these paths. Configuration precedence is JSON → JS → MJS; invalid highest-precedence configuration uses discovery defaults rather than falling through. Config entry modules reload, but imported helpers remain cached and require a server restart. ESM reloads retain unique module-cache entries.

The second slice adds capability-aware dynamic watch registration for resolved and missing sources, config candidates, package metadata, and shallow package directories, with a 750 ms metadata-polling fallback for unsupported/rejected registration and 100 ms debounce. VS Code's fixed-name watches were removed. Automated stdio tests cover actual fallback filesystem changes as well as client registration refresh/disposal, reload races, and shutdown. Live VS Code/Zed smoke tests and large-workspace performance remain externally unverified. LSP settings transport and the remaining lifecycle/provider/distribution findings are unchanged. Work is tracked in the vault parent task `task-2026-09-20-implement-dsls-rfc-0005-review` and six linked implementation tasks; no deferrals have been approved.

## Verdict

The core language-server MVP is implemented, but RFC 0005 is not fully delivered. Its unchecked phase list is stale, and some configuration and component capabilities are still missing. Passing tests do not establish coverage of every RFC requirement.

## Implemented

- TypeScript stdio LSP with completion, hover, diagnostics, and replacement code actions.
- Package discovery through `customElements` and `designSystem`, plus explicit manifest sources.
- CEM tag/attribute/value and slot completion; token and utility completion and hover.
- Token manifest, DTCG-style token input, and categorized/flat utility parsing.
- Deprecated completion tags, time-aware diagnostic severity, draft-component diagnostics.
- Replacement fixes for token names, utility classes, attribute values, and attribute names when replacement metadata reaches diagnostics.
- VS Code client and local-server Zed wrapper.
- Additional capabilities beyond the original RFC: token-document schema diagnostics, compact slot descriptions, JSX static template-literal class recognition.

## Remaining gaps

### P1: Configuration and reload behavior

- **JS config is not wired into server startup.** `src/discovery.ts` has a JS-capable `loadConfig`, but `src/server.ts` directly loads only `ds.config.json`.
- **Config file changes reload manifests using stale config.** `onDidChangeWatchedFiles` calls `loadManifests` without rereading configuration. Creating/deleting/changing config does not reliably update sources.
- **Manifest watching is incomplete.** VS Code watches fixed filename patterns, not every discovered manifest path. Arbitrary CEM filenames and common token filenames can be missed. The server does not register watched files itself; Zed has no equivalent watcher wiring here.
- **Declared settings are not implemented end-to-end:** `languages`, `templateTags`, `classAttributes`, and diagnostic per-package overrides. The Zed RFC example passing `sources` and `diagnostics` via LSP settings is not consumed by the wrapper/server path.

Evidence: `src/server.ts`, `src/discovery.ts`, `src/types.ts`, `src/providers/diagnostics.ts`, `editors/vscode/extension.js`, `editors/zed/src/lib.rs`.

### P1: Lifecycle information is inconsistent across entity types

- Token, utility, and attribute hovers retain reference information but omit the RFC's actionable replacement/removal callout. Attribute-value hover marks deprecated alternatives but does not show the selected value's migration message/removal details.
- CEM attribute/member `replacement`, `status`, and separate `deprecationMessage` fields are not fully propagated. Consequently, a supported attribute quick-fix handler cannot offer fixes for ordinary CEM attribute replacements lost in parsing.
- Tokens/utilities with only `status: "deprecated"` are normalized with `deprecated: false`; the shared `isDeprecated` helper respects that false flag, masking status-only deprecation. CEM components now handle this case, but the other parsers do not.
- Component replacements now reach diagnostics, but code actions have no deprecated-component handler. Any future component rename fix must handle matching opening/closing tags safely.

Evidence: `src/parsers/cem.ts`, `src/parsers/tokens.ts`, `src/parsers/utilities.ts`, `src/lifecycle.ts`, `src/providers/hover/{variable,class,attribute,attribute-value}.ts`, `src/providers/code-actions.ts`.

### P2: Component API completion coverage

These explicit RFC promises are not implemented:

- Lit `.property=` completion from CEM members (members currently enrich attributes only).
- Lit `@event` completion.
- `::part()` completion.
- Component-scoped CSS custom-property completion. CEM properties are parsed but CSS-variable completion iterates tokens only.
- Lit `classMap` recognition. Class strings and static JSX template segments work, not arbitrary class-producing expressions.

Events, CSS parts, and CSS properties being stored is not equivalent to exposing them through providers.

Evidence: `src/parsers/cem.ts`, `src/providers/completion.ts`, `src/providers/completion/css-variable.ts`, `src/scanner/context.ts`, `src/class-values.ts`.

### P2: Distribution and ecosystem validation

- Zed wrapper runs a local/configured Node server; it does not download/cache platform-specific binaries as proposed.
- No JetBrains integration in this repository (explicitly a later RFC target).
- Marketplace/release publication, the documentation site, changes to Acme's external build pipelines, and testing against external design systems cannot be established from this checkout alone. VS Code Marketplace availability was reported by the user; that does not verify every distribution goal.
- No demonstrated performance benchmark for the RFC's large-design-system scenario in this audit.

## Intentional drift: update the RFC, not the implementation

- Component hover is deliberately compact: opening description paragraph, slot descriptions, actionable lifecycle notices. Do not restore the old exhaustive attribute lists or routine status/package fields simply to match its example.
- Explicit sources merge with discovery rather than overriding it. This is documented behavior, with `discovery.enabled: false` available for explicit-only sources.
- Design Lasagna now permits arbitrary lifecycle status strings; the RFC's four-value union is outdated. CEM now preserves them; token/utility parsers still filter status values.
- The delivery sequence changed: VS Code is available while Zed's proposed automatic binary distribution remains unfinished.

## Suggested next work

1. Centralize config loading and fix config/manifest watch registration with server-level integration tests.
2. Complete lifecycle propagation and consistent compact hover callouts; test status-only deprecation through parser → store → diagnostics/actions.
3. Explicitly implement or defer configurable recognition and per-package severities.
4. Implement or defer Lit properties/events, parts, scoped custom properties, and `classMap` separately.
5. Refresh RFC phase checkboxes with implemented, partial, deferred, and externally unverified statuses.

## Validation

Independent review reran `npm test` (107 passing tests) and `npm run build` successfully. Zed compilation could not be checked because the local `wasm32-wasip1` Rust target is missing. This review does not change runtime code or the original RFC.

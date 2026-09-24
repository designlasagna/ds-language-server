# Design Lasagna Language Server changelog

Notable changes to the standalone `@designlasagna/ds-language-server` package are documented here. This is the canonical record for server behavior shared by every editor integration.

Editor adapter, packaging, and editor-specific UX changes belong in the changelog under `editors/<editor>/`.

## [Unreleased]

### Added

- Zed wrapper auto-installs the published `@designlasagna/ds-language-server` npm package into the extension's working directory and runs it with the Node runtime bundled with Zed, so no user-installed Node is required. The latest published version is tracked by default; a new `serverVersion` language-server setting pins an exact version, and the existing `serverPath`/`nodePath` settings remain available as development overrides.
- Publish guard (`npm run check:publishable`) that fails when the package still carries local `file:` runtime dependencies or a missing `bin` entry, and a `publish-npm.yml` workflow that publishes on `v*` tags with provenance once the `@designlasagna/schemas` dependency points at the npm registry.
- Explicit editor-over-project recognition settings, reset semantics and race-safe LSP settings transport; configurable languages, template tags, class attributes and per-package deprecation severity.
- Lit public-property/event completion, component-scoped CSS custom properties and `::part()` suggestions, and static `classMap` key completion/hover/diagnostics with source-safe replacement ranges.
- Synthetic scale benchmark and RFC delivery evidence separating local verification from outstanding external checks.
- Utility class completion and hover in JSX template literals, including static classes alongside interpolations such as ``className={`${styles.header} acme-text-heading-1`}``.
- Richer component fixtures with descriptions, usage examples, and dedicated lifecycle test coverage.
- Capability-aware watches for config candidates, resolved manifest paths (including missing files and arbitrary filenames), package metadata, and package-directory changes. Clients without dynamic registration, or rejecting it, use 750 ms metadata polling with debounced reloads.
- Watcher lifecycle and stdio regression coverage for automatic file/config reloads, package discovery, rejected registrations, reload races, and shutdown.
- Explicit `lifecycle.profile: "0.4"` selection for CEM/DTCG and native v0.4 manifest dispatch, using the local `@designlasagna/schemas@0.4.0` dependency.

### Changed

- Zed extension and root package versions moved to 0.2.0 in preparation for the first npm publication (the publication itself is blocked until `@designlasagna/schemas@0.4.0` is published and the local `file:../schemas` dependency is switched to a registry range).
- Component hover now shows the opening description paragraph and individual slots with descriptions instead of package details and exhaustive attribute lists.
- Component hover hides routine `ready` and `stable` statuses while retaining other lifecycle statuses and actionable deprecation notices.
- Static utility classes in JSX template literals are included in document scanning; interpolation expressions are excluded from class recognition.

### Fixed

- Select the native v0.4 token schema by manifest version and the DTCG extension schema by explicit lifecycle profile in token-document diagnostics.
- Preserve authored nested `status` on CEM attributes, members, slots, events, and CSS properties/parts under the 0.4 lifecycle profile; exclude non-field, private, static, and read-only members from writable Lit property suggestions.
- Fix the Zed settings-forwarding regression by unwrapping `dsLanguageServer` section-wrapped initialization options and workspace/configuration responses before merging editor settings.
- Use one configuration loader for startup and reloads, supporting `ds.config.json`, `ds.config.js`, and `ds.config.mjs` in that precedence order. Invalid or deleted configuration falls back to discovery defaults instead of retaining stale sources.
- Reload edited configuration entry modules, ignore superseded asynchronous loads, and correctly decode workspace file URIs. Imported config helpers still require a server restart.
- Preserve arbitrary CEM lifecycle status strings and component replacement metadata.
- Compact lifecycle hover callouts for tokens, utilities, attributes, and deprecated attribute values; component replacements remain diagnostic-only while verified attribute replacements retain safe actions.
- Recognize component `deprecated` and `removed` statuses when no explicit deprecation flag is supplied.
- Preserve slot deprecation, replacement, and removal metadata; show compact warnings in component hover and migration details in slot hover.

## [0.1.4]

Initial preview release.

### Added

- Component, attribute, token, utility-class, and slot IntelliSense
- DTCG and Design Lasagna schema diagnostics
- Lifecycle-aware deprecated-item diagnostics and migration quick fixes
- Local manifest configuration and package discovery

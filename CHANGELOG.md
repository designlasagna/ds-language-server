# Design Lasagna Language Server changelog

Notable changes to the standalone `@designlasagna/ds-language-server` package are documented here. This is the canonical record for server behavior shared by every editor integration.

Editor adapter, packaging, and editor-specific UX changes belong in the changelog under `editors/<editor>/`.

## [Unreleased]

### Added

- Utility class completion and hover in JSX template literals, including static classes alongside interpolations such as ``className={`${styles.header} acme-text-heading-1`}``.
- Richer component fixtures with descriptions, usage examples, and dedicated lifecycle test coverage.
- Capability-aware watches for config candidates, resolved manifest paths (including missing files and arbitrary filenames), package metadata, and package-directory changes. Clients without dynamic registration, or rejecting it, use 750 ms metadata polling with debounced reloads.
- Watcher lifecycle and stdio regression coverage for automatic file/config reloads, package discovery, rejected registrations, reload races, and shutdown.

### Changed

- Component hover now shows the opening description paragraph and individual slots with descriptions instead of package details and exhaustive attribute lists.
- Component hover hides routine `ready` and `stable` statuses while retaining other lifecycle statuses and actionable deprecation notices.
- Static utility classes in JSX template literals are included in document scanning; interpolation expressions are excluded from class recognition.

### Fixed

- Use one configuration loader for startup and reloads, supporting `ds.config.json`, `ds.config.js`, and `ds.config.mjs` in that precedence order. Invalid or deleted configuration falls back to discovery defaults instead of retaining stale sources.
- Reload edited configuration entry modules, ignore superseded asynchronous loads, and correctly decode workspace file URIs. Imported config helpers still require a server restart.
- Preserve arbitrary CEM lifecycle status strings and component replacement metadata.
- Recognize component `deprecated` and `removed` statuses when no explicit deprecation flag is supplied.
- Preserve slot deprecation, replacement, and removal metadata; show compact warnings in component hover and migration details in slot hover.

## [0.1.4]

Initial preview release.

### Added

- Component, attribute, token, utility-class, and slot IntelliSense
- DTCG and Design Lasagna schema diagnostics
- Lifecycle-aware deprecated-item diagnostics and migration quick fixes
- Local manifest configuration and package discovery

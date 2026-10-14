# Design Lasagna: Design System Language Server changelog

Notable changes to the npm server package, [`@designlasagna/ds-language-server`](https://www.npmjs.com/package/@designlasagna/ds-language-server), are recorded here. Editor adapters have their own changelogs in `editors/<editor>/`.

The server, VS Code extension, and Zed extension are independently versioned. Editor changelogs identify the server version they bundle or install when that matters.

## [Unreleased]

### Added

- Unknown fields in native v0.4 token and utility manifests are noted in the server log, one `[manifest]` line per manifest when manifests load (including those in `node_modules`), e.g. `[manifest] path/tokens.json: fields not used by the language server: tokens["color.bg"].foo`. Schemas are open, so unknown fields are ignored, never altered and never reported as diagnostics. Known fields come from the installed `@designlasagna/schemas`; `metadata`, platform keys and mode/collection/condition maps are skipped.

### Fixed

- Hovers and completions show composite token values (border, typography, single shadow) and layered values (multi-layer shadows, gradient stops) as readable text instead of `[object Object]`.

### Changed

- Requires `@designlasagna/schemas` 0.4.5, so v0.4 manifests with string-array `resolved` values and custom utility variant kinds validate.

## [0.2.0]

### Added

- npm distribution for the language server.
- Configurable recognition settings for languages, template tags, class attributes, and per-package deprecation severity.
- Completions for Lit properties/events, component-scoped CSS properties, `::part()`, and static `classMap` keys.
- Capability-aware configuration and manifest watching, with polling fallback for clients without dynamic watch registration.
- Opt-in v0.4 lifecycle support for CEM and DTCG sources, plus native v0.4 token and utility manifest handling.

### Changed

- Component hovers are more concise while retaining lifecycle and migration guidance.
- Configuration supports JSON, CommonJS, and ESM files with reliable reload behavior.

### Fixed

- Lifecycle metadata and safe replacement actions are preserved across token, utility, attribute, member, slot, event, and CSS metadata.
- Token-document schema selection follows native manifest versions and explicit DTCG lifecycle profiles.

## [0.1.4]

Initial preview release.

- Component, attribute, token, utility-class, and slot IntelliSense.
- DTCG and Design Lasagna schema diagnostics.
- Lifecycle-aware diagnostics and migration quick fixes.
- Local manifest configuration and package discovery.

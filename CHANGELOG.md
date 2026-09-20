# Changelog

Notable changes to this project are documented here.

## [Unreleased]

### Added

- Utility class completion and hover in JSX template literals, including static classes alongside interpolations such as ``className={`${styles.header} acme-text-heading-1`}``.
- Richer component fixtures with descriptions, usage examples, and dedicated lifecycle test coverage.

### Changed

- Component hover now shows the opening description paragraph and individual slots with descriptions instead of package details and exhaustive attribute lists.
- Component hover hides routine `ready` and `stable` statuses while retaining other lifecycle statuses and actionable deprecation notices.
- Static utility classes in JSX template literals are included in document scanning; interpolation expressions are excluded from class recognition.

### Fixed

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

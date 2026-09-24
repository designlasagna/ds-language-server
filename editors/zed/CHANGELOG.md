# Design Lasagna: Design System Language Server for Zed changelog

This changelog records Zed-specific integration changes. Shared language-server behavior is documented in the [server changelog](../../CHANGELOG.md).

## [0.2.0]

### Added

- Automatic installation of `@designlasagna/ds-language-server` from npm using Zed's native npm APIs and bundled Node runtime.
- `serverVersion` setting to pin an installed server version; the default follows the latest published version.

### Fixed

- Forwarded `lsp.ds-language-server.settings` consistently through initialization and workspace configuration.
- Corrected the extension repository identity and documented the required WASM target for local extension development.

## [0.1.0]

Initial Zed extension release.

- Starts a configured `ds-language-server` command or the default command on `PATH`.
- Supports `serverPath` and `nodePath` development overrides.

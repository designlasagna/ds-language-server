# Zed extension changelog

All notable changes to the Design Lasagna Language Server Zed extension are documented here. Server behavior shared with other editors is recorded in the [root language-server changelog](../../CHANGELOG.md); this file records Zed-specific integration, packaging, and UX changes.

## [Unreleased]

- Fixed the settings-forwarding regression: the wrapper now forwards `lsp.ds-language-server.settings` as initialization options and workspace configuration; `serverPath` and `nodePath` remain wrapper settings. See [configuration and recognition](../../docs/configuration-and-recognition.md) for supported fields.
- Removed the unused dependency-free SHA-256 helper that was added toward automatic server distribution. Automatic distribution is blocked until an authorized server release with integrity metadata exists: the npm package `@designlasagna/ds-language-server` is unpublished (registry 404), the GitHub repository has no releases or release assets (tags only, and the newest tag predates the current working tree), and the server's `file:../schemas` dependency blocks publication and standalone source builds. Details: [SETUP.md](SETUP.md). The wrapper still honors `serverPath`/`nodePath`, or a `ds-language-server` on the PATH, with no download behavior.
- Corrected the extension repository identity to `designlasagna/ds-language-server` (it previously pointed at the old `Mmmgnus/ds-foundation` repository) and documented the `wasm32-wasip2` target required by `zed_extension_api` 0.7.0 in the setup guide.
- Verification of these changes is native `cargo check --offline` and `cargo test --offline` (re-verified 2026-09-24 after the SHA-256 removal); WASM-target and live-editor checks remain outstanding. See the [language-server changelog](../../CHANGELOG.md) for shared server changes.

## 0.1.0

Initial Zed extension release.

- Starts the configured `ds-language-server` command, or the default command from the user's PATH.
- Supports `serverPath` and `nodePath` Zed language-server settings.

# Changelog

All notable changes to the Design Lasagna Language Server VS Code extension are documented here. Server behavior shared with other editors is recorded in the [root language-server changelog](../../CHANGELOG.md); this file records VS Code-specific integration, packaging, and UX changes.

## [Unreleased]

- Removed fixed-name manifest/config watcher patterns; the server now manages capability-aware watches for resolved paths. See the [language-server changelog](../../CHANGELOG.md) for registration and polling behavior.
- Only explicitly set settings (`dsLanguageServer.languages`, `.templateTags`, `.classAttributes`, `.diagnostics`) are forwarded to the server; extension defaults no longer override project settings. See [configuration and recognition](../../docs/configuration-and-recognition.md).
- The bundled server depends on the local, unpublished sibling schemas package (0.4.0); that local dependency must be replaced during release preparation.

## 0.1.4

Initial preview release.

- Component, attribute, token, utility-class, and slot IntelliSense
- DTCG and Design Lasagna schema diagnostics
- Lifecycle-aware deprecated-item diagnostics and migration quick fixes
- Local manifest configuration and package discovery

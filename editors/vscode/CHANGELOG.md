# Design Lasagna: Design System Language Server for VS Code changelog

This changelog records VS Code-specific integration changes. Shared language-server behavior is documented in the [server changelog](https://github.com/designlasagna/ds-language-server/blob/main/CHANGELOG.md).

## [0.2.0] — planned, not yet published

- Bundle language server 0.2.0 with configurable recognition and v0.4 manifest support.
- Preserve project configuration unless explicitly overridden in editor settings.
- Improve configuration and manifest change watching.
- Replace the local schema dependency with the published package.
- Update packaging tools to resolve reported security vulnerabilities.
- Bundle the extension client into a single generated `client/extension.cjs`; the VSIX now ships only the generated entry points, docs, icon, and licenses — including generated third-party license notices for the bundled dependencies — plus the published schema package as the only external runtime dependency, instead of the full `node_modules` tree.
- **Requires VS Code 1.90 or newer.**

CEM and DTCG v0.4 lifecycle support remains opt-in; see the [setup guide](https://github.com/designlasagna/ds-language-server/blob/main/editors/vscode/README.md#lifecycle-profile).

## [0.1.4]

Initial preview release.

- Component, attribute, token, utility-class, and slot IntelliSense.
- DTCG and Design Lasagna schema diagnostics.
- Lifecycle-aware diagnostics and migration quick fixes.
- Local manifest configuration and package discovery.

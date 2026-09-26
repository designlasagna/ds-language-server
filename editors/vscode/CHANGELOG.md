# Design Lasagna: Design System Language Server for VS Code changelog

This changelog records VS Code-specific integration changes. Shared language-server behavior is documented in the [server changelog](https://github.com/designlasagna/ds-language-server/blob/main/CHANGELOG.md).

## [0.2.0] — planned, not yet published

Local release candidate: the 0.2.0 VSIX has not been published to the Visual Studio Marketplace. Pushing the `vscode-v0.2.0` tag triggers the release workflow, which publishes to the pre-release (preview) channel through a gated environment that can block the run. See [SETUP.md](https://github.com/designlasagna/ds-language-server/blob/main/editors/vscode/SETUP.md#publishing).

The 0.2.0 extension bundles the 0.2.0 language-server code from this repository and declares the published `@designlasagna/schemas` `^0.4.0` as a runtime dependency. The extension keeps Semantic Versioning independent of the npm server, and keeps the stable `DesignLasagna` publisher and `design-system-language-server` extension ID.

- Bundle the 0.2.0 server: configurable recognition, capability-aware configuration and manifest watching with a polling fallback, opt-in v0.4 lifecycle support, and native v0.4 token/utility manifest handling.
- Forward recognition and diagnostic settings (`dsLanguageServer.languages`, `.templateTags`, `.classAttributes`, and `.diagnostics`) only when explicitly configured, so editor defaults do not override project configuration. Explicit object values merge across global → workspace → workspace-folder scopes; arrays replace, including `[]` to disable a list.
- Use server-managed configuration and manifest watching rather than fixed filename-pattern watchers.
- Compatibility: require VS Code `^1.90.0` (`engines.vscode`) and bundle the server with esbuild targeting Node 20.

Caveats:

- The legacy lifecycle adapter remains the default. CEM and DTCG sources opt into the v0.4 lifecycle contract with `"lifecycle": { "profile": "0.4" }` in `ds.config.*`; native token and utility manifests select v0.4 automatically with `schemaVersion: "0.4.0"`.
- Editor settings override only recognition and deprecation severity. Sources, discovery, the lifecycle profile, and `diagnostics.draftUsage` remain project-file settings; editor settings cannot opt a project into a new lifecycle contract.
- Live VS Code reload verification remains a release check separate from the automated LSP tests.

## [0.1.4]

Initial preview release.

- Component, attribute, token, utility-class, and slot IntelliSense.
- DTCG and Design Lasagna schema diagnostics.
- Lifecycle-aware diagnostics and migration quick fixes.
- Local manifest configuration and package discovery.

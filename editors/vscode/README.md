# Design Lasagna: Design System Language Server

Design-system IntelliSense for VS Code. The extension reads your Custom Elements Manifest, token manifests, and utility manifests to provide completions, hover information, schema diagnostics, lifecycle warnings, and migration quick fixes.

## Release status

The 0.2.0 extension is a local release candidate and has not been published to the Visual Studio Marketplace. Pushing a matching `vscode-v<version>` tag triggers the release workflow, which publishes to the pre-release (preview) channel through a gated environment — a tag does not guarantee publication. See [SETUP.md](https://github.com/designlasagna/ds-language-server/blob/main/editors/vscode/SETUP.md#publishing).

## Features

- Component, attribute, attribute-value, and slot completions from a Custom Elements Manifest
- CSS custom-property and utility-class completions from Design Lasagna manifests
- DTCG and Design Lasagna token-document schema diagnostics with precise JSONC ranges
- Native deprecated-item styling and diagnostics with replacement guidance
- Quick fixes for deprecated tokens, utility classes, attributes, and attribute values

## Configure manifests

Add `ds.config.json` to the workspace root when manifests are local or not auto-discovered:

```json
{
  "sources": {
    "components": ["dist/custom-elements.json"],
    "tokens": ["dist/tokens.json"],
    "utilities": ["dist/utilities.manifest.json"]
  }
}
```

The lifecycle profile is a project-file setting: see [Lifecycle profile](#lifecycle-profile) below.

The extension also discovers manifests published by installed design-system packages:

```json
{
  "customElements": "dist/custom-elements.json",
  "designSystem": {
    "tokens": "dist/tokens.json",
    "utilities": "dist/utilities.manifest.json"
  }
}
```

## Automatic reload

The server registers watches for resolved config, package metadata, and manifest paths, including arbitrary filenames and files not created yet. The extension does not use fixed filename-pattern watchers. When a client cannot register watches, the server falls back to 750 ms metadata polling plus a 100 ms debounce. See [configuration and reload details](https://github.com/designlasagna/ds-language-server/blob/main/README.md#configuration-and-automatic-reload).

Rebuild the bundled server when testing source changes. Live VS Code reload verification remains a release check separate from automated tests.

## Lifecycle profile

The bundled 0.2.0 server keeps the legacy lifecycle adapter as the default. To opt CEM and DTCG sources into the v0.4 lifecycle contract, set it explicitly in `ds.config.*`:

```json
{ "lifecycle": { "profile": "0.4" } }
```

Native token and utility manifests select v0.4 automatically with `schemaVersion: "0.4.0"`; they do not require the profile setting. Editor settings cannot change the lifecycle profile — recognition and deprecation severity are the only fields the extension can forward.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `dsLanguageServer.enable` | `true` | Enable or disable the language server. |
| `dsLanguageServer.serverPath` | bundled server | Absolute path to a local server for development. |
| `dsLanguageServer.trace.server` | `off` | LSP trace level: `off`, `messages`, or `verbose`. |

Recognition settings (`dsLanguageServer.languages`, `.templateTags`, `.classAttributes`, and `.diagnostics`) can also be set in editor settings. Only explicitly set values are forwarded to the server, so extension defaults cannot override project settings. Explicit object values merge across global → workspace → workspace-folder scopes, arrays replace (including `[]` to disable a list), and an empty editor snapshot resets the server to project settings. See [configuration and recognition](https://github.com/designlasagna/ds-language-server/blob/main/docs/configuration-and-recognition.md) for supported fields and precedence.

## Development

Packaging and building the extension requires Node 22 or newer (the `@vscode/vsce` packaging tool's minimum). This build-time requirement is separate from extension runtime compatibility: the extension still supports VS Code `^1.90.0`, and its bundled server still targets the host's Node 20 runtime.

From the repository root, build and test the server:

```bash
npm run build
npm test
```

Then package the extension (the packaging guards run before `vsce package` and the candidate is written to `design-system-language-server.vsix`):

```bash
cd editors/vscode
npm ci
npm run package
```

To verify a built candidate without touching your normal editor setup (user settings, default extensions directory, installed extensions), follow the isolated validation flow in [local VSIX candidate validation](https://github.com/designlasagna/ds-language-server/blob/main/editors/vscode/SETUP.md#validate-a-local-vsix-candidate-020).

See the [repository](https://github.com/designlasagna/ds-language-server) for development setup, supported manifests, and issue tracking.

## License

MIT

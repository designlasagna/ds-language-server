# Design Lasagna Language Server

Design-system IntelliSense for VS Code. The extension reads your Custom Elements Manifest, token manifests, and utility manifests to provide completions, hover information, schema diagnostics, lifecycle warnings, and migration quick fixes.

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

The server registers watches for resolved config, package metadata, and manifest paths, including arbitrary filenames and files not created yet. The extension no longer uses fixed filename-pattern watchers. When a client cannot register watches, the server falls back to 750 ms metadata polling plus a 100 ms debounce. See [configuration and reload details](../../README.md#configuration-and-automatic-reload).

Rebuild the bundled server when testing these unreleased changes. Actual VS Code watcher behavior has not yet been manually smoke-tested in this change. The locally built server currently depends on the unpublished sibling schemas package (0.4.0); that local file dependency must be replaced during release preparation.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `dsLanguageServer.enable` | `true` | Enable or disable the language server. |
| `dsLanguageServer.serverPath` | bundled server | Absolute path to a local server for development. |
| `dsLanguageServer.trace.server` | `off` | LSP trace level: `off`, `messages`, or `verbose`. |

Recognition settings (`dsLanguageServer.languages`, `.templateTags`, `.classAttributes`, and `.diagnostics`) can also be set in editor settings. Only explicitly set values are forwarded to the server, so extension defaults cannot override project settings. See [configuration and recognition](../../docs/configuration-and-recognition.md) for supported fields and precedence.

## Development

From the repository root, build and test the server:

```bash
npm run build
npm test
```

Then package the extension:

```bash
cd editors/vscode
npm ci
npm run package
code --install-extension design-system-language-server-0.1.4.vsix
```

See the [repository](https://github.com/designlasagna/ds-language-server) for development setup, supported manifests, and issue tracking.

## License

MIT

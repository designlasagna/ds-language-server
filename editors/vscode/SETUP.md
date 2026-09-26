# VS Code Extension Setup

## Requirements

- Node 22 or newer to install dependencies, build, package, and publish the extension (`@vscode/vsce` requires Node 22+)
- VS Code `^1.90.0` at runtime (declared in `engines.vscode` of `editors/vscode/package.json`)
- The bundled server remains an esbuild bundle targeting Node 20 (`--target=node20`) and runs inside VS Code's Node runtime; the Node 22 packaging requirement does not change extension runtime compatibility

## Install from source (dev)

```bash
cd editors/vscode
npm ci
npm run package    # esbuild bundle + packaging guards + vsce package
code --install-extension design-system-language-server.vsix
```

## How it works

```
editors/vscode/
├── extension.js      ← plain JS client: starts the LSP and forwards explicit settings
├── server/server.js  ← bundled LSP (esbuild from src/server.ts)
└── package.json      ← VS Code extension manifest
```

No TypeScript, no build step for the client. The server is bundled with esbuild. The client forwards only explicitly configured `dsLanguageServer` recognition and diagnostic settings (initialization options, `workspace/configuration` responses, and `workspace/didChangeConfiguration`); defaults are omitted so they cannot override project configuration.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dsLanguageServer.enable` | `true` | Enable/disable the extension |
| `dsLanguageServer.serverPath` | `""` | Custom path to `server.js`. Empty = use bundled. |
| `dsLanguageServer.trace.server` | `"off"` | Trace LSP messages in Output panel |
| `dsLanguageServer.languages` | unset | Custom file languages to activate for. Explicit values replace project values; `[]` disables custom activation; unset falls back to project settings. |
| `dsLanguageServer.templateTags` | unset | Template tag names for `html` and `css`. Arrays replace; `[]` disables that language's tags; unset falls back to project settings. |
| `dsLanguageServer.classAttributes` | unset | Class attribute names recognized by the server. Arrays replace; `[]` disables class attribute recognition; unset falls back to project settings. |
| `dsLanguageServer.diagnostics` | unset | `deprecated` severity plus per-package overrides; a package value overrides the global value; unset falls back to project settings. |

Only explicitly configured values are forwarded to the server; if none are set, the extension sends an empty snapshot and the server resets the editor layer to project settings. Sources, discovery, the lifecycle profile, and `diagnostics.draftUsage` cannot be set from editor settings — configure them in `ds.config.*`. See [configuration and recognition](https://github.com/designlasagna/ds-language-server/blob/main/docs/configuration-and-recognition.md) for the full contract.

## Automated smoke checks

Requires `unzip` and Node 22+. Run from `editors/vscode`:

```bash
npm run smoke:vsix
npm run smoke:vsix -- --skip-vscode
```

`npm run smoke:vsix` runs the isolated desktop VS Code tests; set `CODE_BINARY` or `CODE_HOST_BINARY` to point at a specific VS Code build. `npm run smoke:vsix -- --skip-vscode` runs the headless LSP protocol checks only.

## Validate a local VSIX candidate (0.2.0)

The 0.2.0 VSIX is a local release candidate, not a Marketplace release. Validate it in an isolated environment so your user settings and installed extensions stay untouched:

1. Build the candidate:

   ```bash
   cd editors/vscode
   npm ci
   npm run package
   ```

2. Create unique disposable directories and install the candidate into that isolated environment:

   ```bash
   user_data=$(mktemp -d)
   extensions_dir=$(mktemp -d)
   code --user-data-dir "$user_data" --extensions-dir "$extensions_dir" \
     --install-extension design-system-language-server.vsix
   ```

3. Open a test workspace in the same isolated environment:

   ```bash
   code --user-data-dir "$user_data" --extensions-dir "$extensions_dir" --new-window /path/to/workspace
   ```

4. Verify completions, hover, diagnostics, and quick fixes manually against a workspace with a `ds.config.json`, then close the window. The `mktemp` directories are unique per run and can be removed manually (or left in place) when you are done.

## Publishing

Marketplace releases are pre-releases (preview channel) and use independent Semantic Versioning. The VS Code extension version in `editors/vscode/package.json` must match the `vscode-v<version>` release tag; it does not need to match the npm server version. The publisher (`DesignLasagna`) and extension ID (`design-system-language-server`) are stable across releases. No 0.2.0 release has been published yet. Pushing the `vscode-v0.2.0` tag triggers the release workflow, which publishes through the gated `vscode-marketplace` environment; the run can be blocked or fail, so a tag does not guarantee publication.

1. Create a Visual Studio Marketplace publishing token for the `DesignLasagna` publisher.
2. Add it as the `VSCE_PAT` secret in GitHub's `vscode-marketplace` environment.
3. Validate the local VSIX candidate first (see above), then tag and push the approved release:

```bash
git tag -a vscode-v0.2.0 -m "VS Code extension v0.2.0"
git push origin vscode-v0.2.0
```

When it completes, the workflow tests the server, packages and validates the VSIX, and publishes it with `--pre-release`.

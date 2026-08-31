# VS Code Extension Setup

## Install from source (dev)

```bash
cd editors/vscode
npm install
npm run bundle-server

# Package and install
npx vsce package --allow-missing-repository
code --install-extension design-system-language-server-0.1.3.vsix
```

Or for F5 development:
1. Open the repo root in VS Code
2. `Run and Debug` → select "Launch Extension"
3. A new VS Code window opens with the extension active

## How it works

```
editors/vscode/
├── extension.js      ← 60 lines of plain JS, starts the LSP
├── server/server.js  ← bundled LSP (esbuild from src/server.ts)
└── package.json      ← VS Code extension manifest
```

No TypeScript, no build step for the client. The server is bundled with esbuild.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dsLanguageServer.enable` | `true` | Enable/disable the extension |
| `dsLanguageServer.serverPath` | `""` | Custom path to `server.js`. Empty = use bundled. |
| `dsLanguageServer.trace.server` | `"off"` | Trace LSP messages in Output panel |

## Publishing

Marketplace releases are pre-releases and are published only from a matching Git tag. The root package and `editors/vscode/package.json` versions must match the tag (for example, `v0.1.3`).

1. Create a Visual Studio Marketplace publishing token for the `DesignLasagna` publisher.
2. Add it as the `VSCE_PAT` secret in GitHub's `vscode-marketplace` environment.
3. Tag and push the approved release:

```bash
git tag -a v0.1.3 -m "VS Code extension v0.1.3"
git push origin v0.1.3
```

The release workflow tests the server, packages the VSIX, and publishes it with `--pre-release`. Before tagging, install the VSIX locally with `npm run package` and `code --install-extension design-system-language-server-0.1.3.vsix`.

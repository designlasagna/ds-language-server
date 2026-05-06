# VS Code Extension Setup

## Install from source (dev)

```bash
cd editors/vscode
npm install
npm run bundle-server

# Install in VS Code
code --install-extension .
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

```bash
cd editors/vscode
npm run package    # creates ds-language-server-0.1.0.vsix
code --install-extension ds-language-server-0.1.0.vsix  # local install
# or
vsce publish       # publish to VS Code marketplace
```

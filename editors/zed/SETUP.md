# Zed Extension Setup

## How it works

Zed requires an extension to register any custom Language Server. The extension is a thin WASM shim (~263KB) that tells Zed:

1. "A language server called `ds-language-server` exists"
2. "Activate it for HTML, CSS, TS, TSX, JSX files"
3. "Start it by running this command"

You **always need the extension installed** — the LSP binary alone does nothing without it.

---

## End goal (once published to Zed marketplace)

Users will just:
1. Open Zed's extension panel → search "Design System" → click Install
2. Done. The extension downloads the LSP binary automatically.

We're not there yet. For now, follow the dev setup below.

---

## Dev setup (current)

### Prerequisites
- Node.js ≥ 20
- Rust toolchain with `wasm32-wasip1` target (for compiling the extension)

### 1. Clone and build the LSP

```bash
git clone https://github.com/Mmmgnus/ds-foundation.git
cd ds-foundation
npm install
npm run build
```

### 2. Install Rust WASM target (one-time)

```bash
rustup target add wasm32-wasip1
```

### 3. Fix macOS GUI PATH issue

Zed (as a macOS GUI app) doesn't inherit your shell PATH. It can't find `cargo` or `rustc` without this:

```bash
sudo launchctl setenv PATH "$HOME/.cargo/bin:$(dirname $(which node)):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Then **fully quit and reopen Zed** (Cmd+Q, not just close window).

### 4. Install the dev extension in Zed

1. `Cmd+Shift+P` → "zed: install dev extension"
2. Select the `editors/zed/` directory from the cloned repo
3. Zed compiles the Rust → WASM and registers the extension

### 5. Configure Zed settings

Add to `~/.config/zed/settings.json`:

```json
{
  "lsp": {
    "ds-language-server": {
      "settings": {
        "serverPath": "/absolute/path/to/ds-foundation/dist/server.js",
        "nodePath": "/absolute/path/to/node"
      }
    }
  }
}
```

Find your paths:
```bash
echo "$(pwd)/dist/server.js"   # from the ds-foundation directory
which node
```

### 6. Verify

1. Open a project with a `ds.config.json` or a design system package in `node_modules`
2. Open an HTML/TSX/CSS file
3. `Cmd+Shift+P` → "debug: open language server logs"
4. Look for "DS Language Server initialized"

---

## Manifest reloads

Use workspace `ds.config.json`, `ds.config.js`, or `ds.config.mjs` for manifest configuration. Reloading is implemented by the Node server, not the WASM wrapper: it registers targeted watches if the client advertises support, otherwise it polls file/directory metadata every 750 ms with a 100 ms debounce. Rejected registrations also fall back to polling. Missing manifest creation, arbitrary filenames, config changes, and package metadata changes are covered by automated stdio LSP tests.

Rebuild the server to use these unreleased changes. A live Zed smoke test is still needed; no Zed extension compilation or distribution claim is implied. Imported JS config helpers require a server restart. This does not add forwarding of manifest `sources` or `diagnostics` from Zed settings.

## Settings reference

| Setting | Required | Description |
|---------|----------|-------------|
| `serverPath` | No* | Absolute path to `dist/server.js`. Falls back to `ds-language-server` in PATH. |
| `nodePath` | No* | Absolute path to `node` binary. Falls back to `node` in PATH. |

\* Required for dev setup since Zed GUI apps don't reliably find binaries in PATH.

---

## Troubleshooting

### "Failed to compile extension"
- Ensure `launchctl setenv PATH` includes `~/.cargo/bin`
- Fully restart Zed (Cmd+Q, reopen)
- Verify: `rustup target list --installed` should show `wasm32-wasip1`

### LSP not starting
- Check logs: `Cmd+Shift+P` → "debug: open language server logs"
- Verify `serverPath` points to an existing `dist/server.js`
- Verify `nodePath` points to a working node ≥ 20
- Try running manually: `node /path/to/dist/server.js --stdio` (should hang waiting for input)

### No completions appearing
- Ensure a `ds.config.json` exists in workspace root, OR
- Ensure `node_modules` contains a package with `customElements` or `designSystem` in its `package.json`
- Check LSP logs for "Discovered manifests" messages

### Extension installed but no LSP activity
- The extension only activates for: HTML, CSS, SCSS, JavaScript, TypeScript, TSX, JSX
- Open a file of one of those types and check logs again

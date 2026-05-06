# Zed Extension Setup

## For co-workers (simplest path)

### Prerequisites
- Node.js ≥ 20
- Rust toolchain with `wasm32-wasip1` target (for building the Zed extension)

### One-time setup

```bash
# 1. Clone and build the LSP
git clone https://github.com/Mmmgnus/ds-foundation.git
cd ds-foundation
npm install
npm run build

# 2. Install Rust wasm target (if not already)
rustup target add wasm32-wasip1

# 3. Fix macOS GUI PATH issue (Zed can't find cargo/rustc)
#    Add this to your shell profile (~/.zshrc) and run once:
sudo launchctl setenv PATH "$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$(dirname $(which node))"
#    Then restart Zed (fully quit and reopen)

# 4. Install dev extension in Zed
#    Cmd+Shift+P → "zed: install dev extension"
#    Select the `editors/zed/` directory from the cloned repo
```

### Configure Zed settings

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
# Server path
echo "$(cd ~/path/to/ds-foundation && pwd)/dist/server.js"

# Node path
which node
```

### Verify it works

1. Open a project that has a design system package in `node_modules` with:
   - `customElements` field in its `package.json` (for components)
   - `designSystem.tokens` field (for tokens)
   - `designSystem.utilities` field (for utilities)
2. Open an HTML/TSX/CSS file
3. Check Zed's LSP status: Cmd+Shift+P → "debug: open language server logs"
4. You should see "DS Language Server initialized" in the logs

---

## Simplifying for the future

Once published to npm:
```bash
npm install -g @ds-foundation/language-server
```

Then Zed settings just needs:
```json
{
  "lsp": {
    "ds-language-server": {
      "settings": {}
    }
  }
}
```

The extension falls back to `ds-language-server` (global bin) when no `serverPath` is configured.

---

## Troubleshooting

### "Failed to compile extension"
- Ensure `launchctl setenv PATH` includes `~/.cargo/bin`
- Fully restart Zed (Cmd+Q, reopen)
- Check: `rustup target list --installed` should include `wasm32-wasip1`

### LSP not starting
- Check logs: Cmd+Shift+P → "debug: open language server logs"
- Verify `serverPath` points to an existing `dist/server.js`
- Verify `nodePath` points to a working node binary ≥ 20

### No completions appearing
- Ensure the project's `node_modules` contains a package with `customElements` or `designSystem` in its `package.json`
- Check the LSP log for "Discovered manifests" messages

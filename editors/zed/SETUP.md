# Design Lasagna: Design System Language Server for Zed

This directory contains the Zed extension for the Design Lasagna: Design System Language Server (DSLS).

## Availability

The extension automatically installs the public [`@designlasagna/ds-language-server`](https://www.npmjs.com/package/@designlasagna/ds-language-server) package and runs it with Zed's bundled Node runtime. The extension is ready for local development installation; Zed's public extension registry listing is a separate, pending submission.

## Settings

Configure the extension under `lsp.ds-language-server.settings` in Zed's `settings.json`:

```json
{
  "lsp": {
    "ds-language-server": {
      "settings": {
        "serverVersion": "0.2.0",
        "lifecycle": { "profile": "0.4" }
      }
    }
  }
}
```

- `serverVersion` pins an exact npm server version. Omit it to follow the latest published version.
- `serverPath` is a development override that launches a local server build instead of the npm-installed package.
- `nodePath` overrides the Node executable. Omit it to use Zed's bundled Node runtime.
- Other settings, such as `templateTags` and `diagnostics`, are forwarded to DSLS. Put manifest sources and lifecycle policy in `ds.config.json`, `ds.config.js`, or `ds.config.mjs`.

For the complete settings and precedence reference, see [configuration and recognition](../../docs/configuration-and-recognition.md).

## Development installation

1. Build the extension as described below.
2. In Zed, open the Extensions panel and choose **Install Dev Extension**.
3. Select this `editors/zed` directory.
4. Open a workspace containing a `ds.config.*` file or installable design-system manifests.

Zed installs the server package in its extension work directory. Inspect the Language Server log if installation or startup fails.

## Build the wrapper

The wrapper requires the Rust `wasm32-wasip2` target.

```sh
cd editors/zed
cargo build --release --target wasm32-wasip2
```

The resulting component is:

```text
target/wasm32-wasip2/release/ds_language_server_zed.wasm
```

With a rustup-managed toolchain, install the target with:

```sh
rustup target add wasm32-wasip2
```

On Arch Linux's system Rust toolchain, install the `rust-wasm` package instead.

Host-side checks do not require the WASM target:

```sh
cargo check --offline --manifest-path editors/zed/Cargo.toml
cargo test --offline --manifest-path editors/zed/Cargo.toml
```

## Test against a local server build

Use explicit overrides only when developing the server itself:

```json
{
  "lsp": {
    "ds-language-server": {
      "settings": {
        "serverPath": "/absolute/path/to/ds-language-server/dist/server.js",
        "nodePath": "/absolute/path/to/node"
      }
    }
  }
}
```

Build the local server first with `npm run build` from the repository root.

## Zed registry publication

The Zed registry is published separately from the npm server. A registry pull request pins this repository as a submodule and points to this extension directory:

```toml
[ds-language-server]
submodule = "extensions/ds-language-server"
path = "editors/zed"
version = "0.2.0"
```

The Zed extension has independent Semantic Versioning. Its registry version changes only when the extension changes; it does not need to match every npm server release.

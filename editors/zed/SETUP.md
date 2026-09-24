# Zed editor setup

This folder contains the Zed extension for the Design Language Server (DSLS).

## Current status

- **Automatic distribution is implemented.** The wrapper installs the
  published `@designlasagna/ds-language-server` npm package into the
  extension's working directory via Zed's native npm API and runs
  `dist/server.js` with the Node runtime bundled with Zed. No user-installed
  Node, manual download, or separate download host is needed.
- **It is gated on the release chain.** Until `@designlasagna/ds-language-server`
  exists on npm, Zed shows an installation failure with a clear message. The
  chain is:
  1. Publish `@designlasagna/schemas@0.4.0` (schemas repo is code-complete at
     `0.4.0`; push/tag requires approval).
  2. Switch this repo's dependency from `file:../schemas` to `^0.4.0` and
     regenerate the lockfile (`npm run check:publishable` gates this).
  3. Publish `@designlasagna/ds-language-server` via the `v*` tag
     (`publish-npm.yml`, provenance publishing).
- **Registry registration is a separate PR.** Zed's extension registry
  (`zed-industries/extensions`) pins public repos as git submodules with a
  per-extension `path`, so the DSLS monorepo can host the extension in place:
  the registry entry pins this repository and points `path = "editors/zed"`
  at this folder (the same layout the registry uses for Zed's own in-tree
  extensions). One extension per PR; review typically takes a few weeks.

## Version policy

- By default the wrapper tracks the **latest published** version of
  `@designlasagna/ds-language-server` (the same pattern Zed's own HTML
  extension uses).
- Pin an exact version per project or globally with the
  `serverVersion` setting under `language_servers.ds-language-server`.
- Integrity comes from the npm registry itself (integrity hashes on every
  published tarball) plus Zed's bundled, Zed-updated Node runtime — no
  hand-rolled download host or checksum manifest is needed.

## Settings

Under `language_servers.ds-language-server` in `settings.json`:

```json
{
  "language_servers": {
    "ds-language-server": {
      "serverVersion": "0.2.0",
      "serverPath": "/absolute/path/to/dist/server.js",
      "nodePath": "/absolute/path/to/node",
      "lifecycle": { "profile": "0.4" }
    }
  }
}
```

- `serverVersion` — pin an exact published server version (default: track
  latest).
- `serverPath` — development override: launch a local build directly instead
  of the installed package.
- `nodePath` — override the Node binary (default: Zed's bundled Node).
- Other settings (e.g. `lifecycle`, `diagnostics`) are forwarded to the
  server unchanged.

## Development

### Building the wrapper (requires the wasm32-wasip2 target)

```sh
cd editors/zed
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 -O
```

The build output is `debug/ds_language_server_zed.wasm` or
`release/ds_language_server_zed.wasm` in this folder.

Host-side type checking works without the wasm target:

```sh
cargo check --offline --manifest-path editors/zed/Cargo.toml
```

### Testing the server locally

```sh
# From the repository root
npm run build
node dist/server.js --stdio
```

To point the extension at a local build, set `serverPath` to
`dist/server.js` (absolute path) in the settings above.

## Publishing to the Zed registry

1. Make sure the server package is published to npm (see release chain above).
2. Open a pull request against `zed-industries/extensions` that adds this
   repository as a git submodule and adds an `extensions.toml` entry such as:

   ```toml
   [ds-language-server]
   submodule = "extensions/ds-language-server"
   path = "editors/zed"
   version = "0.2.0"
   ```

3. Subsequent server or extension updates are new PRs that bump the pinned
   commit (and version), following the registry's one-extension-per-PR rule.

# VS Code extension bundling plan

Status: slices 1 and 2 implemented on the bundling branch (not yet merged or published).

Slice 2 note: Ajv, ajv-formats, and jsonc-parser are fully bundled. jsonc-parser 3.3.1
ships no `exports` map and its `main` is a UMD build whose internal
`require("./impl/...")` calls esbuild cannot inline, so `bundle-server` aliases
`jsonc-parser` to `jsonc-parser/lib/esm/main.js` (its plain ESM entry). The
Ajv and ajv-formats use static imports, while the external schema JSONs keep
`createRequire`; the npm server retains Node >= 20.0 and its Node16 tsconfig.
Both the tsc ESM build (isolated Node 20.0 npm-tarball smoke) and the bundled
VSIX (isolated protocol + extension-host smoke) are validated.
Bundled third-party license notices are generated into
`editors/vscode/licenses/THIRD-PARTY-NOTICES.md` and enforced by the packaging guard.

## Goal and baseline

Reduce the VSIX's file count and unnecessary package contents without changing extension behavior or breaking the separately published npm server.

The inspected candidate contains 515 ZIP entries and 299 JavaScript files. Of these, 506 entries are under `extension/node_modules`. The server is already bundled; the extension client and explicitly external server dependencies are not. Ajv also ships TypeScript source files that the existing exclusions miss.

Smaller file counts are measurable; faster activation is a hypothesis, not a claim. Record archive bytes, unpacked bytes, total files and JS files before/after. Do not chase warning suppression by dropping necessary runtime files.

## Implementation slices

### 1. Bundle the client and tighten packaging

- Keep `editors/vscode/extension.js` as editable source. Bundle to a **different generated path**, e.g. `client/extension.cjs`; point manifest `main` there. Never overwrite source with its bundle.
- Use esbuild CommonJS, Node20 target, with `vscode` and Node built-ins external. Bundle `vscode-languageclient` and its dependency tree.
- Keep the server output at `server/server.js` and current server behavior unchanged for this slice.
- Introduce an explicit packaged-file policy: generated entry points, manifest, docs, icon, licenses and only the server's remaining external runtime dependency closure. Derive/verify that closure rather than assuming a package is client-only because of its name.
- Exclude source/test/tooling/build-only files, including unnecessary Ajv TypeScript sources. Preserve licenses for bundled dependencies through retained notices or a generated third-party notices file.
- Update package guards together with exclusions. They currently require every production lockfile dependency's package.json in the archive, which is incorrect for bundled dependencies. Preserve local-reference/symlink rejection and add missing-bundle/unexpected-file regression tests.
- Client bundling is expected to remove much of its approximately 192-file dependency subtree; actual reduction is an acceptance measurement, not a guaranteed exact count.

### 2. Bundle remaining server JavaScript dependencies

- Investigate bundling Ajv, ajv-formats and jsonc-parser. `src/schema-validation.ts` currently uses a locally bound `createRequire`, so merely removing esbuild `external` flags will not reliably inline its dependencies.
- Prefer a small static-JavaScript-import refactor if it works with the repository's TypeScript/ESM interop. Verify it against the npm server build as well as the VSIX; do not change shared source solely to satisfy the bundler without testing both paths.
- Keep the published schema JSON package external initially, including all six directly loaded schemas and any referenced resources. Preserve schema IDs and lifecycle/DTCG behavior.
- Preserve genuinely dynamic user configuration loading in discovery; do not accidentally bundle workspace `ds.config.*` files.
- Tighten the archive allowlist to match the smaller external dependency closure.
- If static-import compatibility needs substantial changes, ship slice 1 first and explicitly defer this slice. Zero node_modules is not a requirement.

## Validation gates for each slice

1. Clean npm dependency installation and full extension audit.
2. Packaging guard regression tests; build and inspect the actual VSIX, metadata, main entry point, licenses and document links.
3. Extract outside the repository and run the existing protocol smoke test with no ancestor dependency fallback.
4. Run actual VS Code extension-host smoke using disposable user-data and extensions directories: activation, completion, schema diagnostics and settings reload.
5. Expand schema assertions to cover v0.3/v0.4 token and DTCG extension/lifecycle loading where current smoke fixtures do not cover them.
6. For shared-source changes: all root tests/build plus an isolated npm package smoke to prove tsc output still resolves its runtime dependencies. A publishability/file-existence check alone is insufficient.
7. Record before/after file counts and bytes; review packaging warnings rather than suppressing them. Keep startup performance claims out unless measured separately.

## Scope and handoff

- Implement on a dedicated local bundling branch based on `release/vscode-0.2.0`, with one focused implementation agent and manager review to avoid repeated delegation rounds.
- No new extension version is required while 0.2.0 remains an unpublished candidate. No npm-server version bump or release automation changes unless a separately justified need is found.
- Update concise changelog, development commands, ignored generated paths, packaging tests and review handoff. Rebuild the final VSIX and refresh its hash.
- Human review before merging into the release branch or publishing; do not tag, push, publish or install into the normal editor profile.

# VS Code 0.2.0 review handoff

## Bundling candidate — 2026-09-27 (latest; local only)

Branch: `feat/vscode-bundling` from `release/vscode-0.2.0`. Neither branch nor artifact was pushed, merged, tagged, or published. The previous candidate results below describe the pre-bundling baseline, not this artifact.

- Editable `extension.js` now builds to `client/extension.cjs`, the manifest entry point; the server build also bundles Ajv, ajv-formats and jsonc-parser. Only `@designlasagna/schemas` remains external. The JSON schema package's six loaded documents and license are retained; its other files, Ajv TypeScript sources and the entire client dependency tree are excluded. A generated third-party notices file covers all production dependencies, including bundled code.
- Packaging guards derive the server's external closure from build flags and lockfile, reject missing bundles, stray archive files/TypeScript sources, stale notices, local dependencies and symlinks; 7/7 regression tests pass. The `jsonc-parser` ESM-entry alias avoids unresolved internal UMD requires. Shared source statically imports Ajv/ajv-formats while loading external schema JSON with `createRequire`; the published npm server's Node >=20.0 floor and Node16 tsconfig remain unchanged.
- Clean `npm ci` in root and extension, root `npm test` (274/274), `npm run build`, `node scripts/check-publishable.mjs`, full extension `npm audit` (0 findings), and `npm run package` all passed. Isolated VSIX protocol **and actual VS Code extension-host** smoke passed: activation, completion, v0.3/v0.4/DTCG schema diagnostics, initial settings and reload. An npm tarball was installed into a disposable consumer outside the repository and its compiled `dist/schema-validation.js` loaded and validated v0.3/v0.4/DTCG fixtures. `git diff --check` passed. No normal editor profile was modified.
- Before (baseline rebuilt from `release/vscode-0.2.0` with clean installs): **515 files, 299 JS files, 2,424,599 unpacked bytes, 728,907 archive bytes**. After: **18 files, 2 JS/CJS files, 900,766 unpacked bytes, 235,828 archive bytes**. File count/size only; activation speed was not benchmarked. VSIX SHA-256: `04d3577c2ff7c4145939b27ca43f9d0d54261be27057865a5dc5d1b8a3692d96` (`editors/vscode/design-system-language-server.vsix`, ignored output). Packaged metadata reports 0.2.0, `./client/extension.cjs`, and `^1.90.0`; docs links remain repository URLs. VSCE reported no packaging warnings requiring suppression.
- Zed compatibility follow-up: Zed 1.18.1 on this machine chooses **system Node 25.1.0 from PATH**, not a fixed bundled Node (confirmed in its own `[node_runtime]` log). The final isolated npm tarball's `dist/schema-validation.js` loads and validates v0.4 manifest/DTCG fixtures under **Node 20.0.0**, with no import-attribute requirement. A disposable Zed profile loaded the local wrapper and launched its LSP using Node 25; its first run auto-installed the **already-published npm 0.2.0** (old `createRequire` build), which logged server startup. After replacing only that disposable work-directory install with the local tarball, Zed launched the local server process (confirmed with a disposable entry-point probe), but did not log a successful initialize/completion before the smoke window ended. **Treat local-tarball-in-Zed completion as unverified**, not passed. The normal Zed profile was not modified, and nothing was published. Zed's runtime choice depends on the host PATH; the unchanged npm Node >=20.0 floor is now verified at 20.0, but a local candidate's Zed completion still needs proof. Since npm 0.2.0 is already published, distributing the changed shared server later requires a separately approved **new npm-server version** (not a republish of 0.2.0); no version change was made here.
- Review correction: reverted the unnecessary Node 20.10 floor and updated the final VSIX after re-running root build/tests, npm-tarball Node 20.0 smoke, extension packaging/protocol and actual disposable VS Code extension-host smoke (all passed). `^1.90.0` was already declared on `release/vscode-0.2.0`, not introduced by this branch. The release workflow builds from the tag; before any tag, verify that its commit contains the notices generator and packaging policy, and rebuild the artifact from that commit.
- Outstanding human review: local-tarball-in-Zed completion, baseline VS Code 1.90 host and manual visual/platform checks remain untested. Do not merge into the release branch, install into the normal editor profile, or publish without approval.


Branch: `release/vscode-0.2.0`. Local candidate only; nothing published, tagged, pushed, or merged.

## Changes

- Extension 0.2.0 bundles current server source; replaces local schemas dependency with published `^0.4.0` and registry lockfile.
- Packaging tools upgraded to `@vscode/vsce` `^4.0.0` and esbuild `^0.28.2`; the full extension dependency audit is now clean.
- Packaging/building requires Node 22+, while runtime compatibility is unchanged: VS Code `^1.90.0` with the bundled server targeting Node 20. Extension/server versions remain independent.
- Packaging guards reject local/linked dependencies and verify required server/schema/runtime files, with three regression tests.
- Release workflow smoke-tests and publishes the exact validated pre-release VSIX rather than repackaging.
- Added isolated protocol and real VS Code extension-host smoke harnesses. Normal user settings/extensions are untouched.
- Updated candidate documentation, lifecycle caveats, installation instructions and packaged repository links.

## Final validation — 2026-09-26

- `npm test`: **274/274 passed** across 19 files.
- `npm run build`: passed.
- `cd editors/vscode && npm ci && npm run package`: passed, including **3/3 packaging tests** and archive validation.
- `npm run smoke:vsix`: passed against the final archive in VS Code **1.138.0**. Verified isolated installation/activation, component completion, packaged schema diagnostics, initial explicit settings and severity reload. Protocol checks also verify clean shutdown.
- `git diff --check`: passed. Inspected packaged README/changelog for malformed repository links: none.
- Full `cd editors/vscode && npm audit`: **0 vulnerabilities** (0 low, 0 moderate, 0 high, 0 critical).
- Inspected the packaged manifest and contents after the vsce major upgrade: identity/version, VS Code `^1.90.0` engine, runtime dependencies, entry point, 515-file payload, and packaged documentation links remain intact; no packaging-tool modules are shipped.

Artifact: `editors/vscode/design-system-language-server.vsix` (ignored build output; 515 files, 729,577 bytes / approximately 712 KiB).

SHA-256: `5edc15a0dbea32e2943192184c1a8127873479f18724278730fbd3a90c51a022`

Reproduce from repository root:

```sh
npm ci && npm test && npm run build
cd editors/vscode
npm ci && npm run package
npm run smoke:vsix                 # isolated desktop test; requires VS Code
npm run smoke:vsix -- --skip-vscode # protocol-only, also used in CI
```

## Review / release gates

- Review minimum VS Code version and candidate docs. The minimum 1.90 host was not directly smoke-tested; the installed 1.138 host was.
- Manual visual hover/quick-fix checks and broader platform/multi-root workflows are not covered by the focused smoke suite.
- Human approval is required before publishing. After publication, verify the actual Marketplace download and then update website release claims. Current Marketplace 0.1.4 is not changed by this local candidate.
- Candidate-status wording in release docs should be updated when publication is approved; website changes were deliberately left untouched.

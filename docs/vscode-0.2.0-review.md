# VS Code 0.2.0 review handoff

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

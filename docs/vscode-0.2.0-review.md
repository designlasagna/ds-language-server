# VS Code 0.2.0 release handoff

## Approved release validation — 2026-10-02

Magnus approved integrating and publishing VS Code 0.2.0 to the **pre-release** channel, with manual visual/platform limitations disclosed. Changelog dated 2026-10-02; packaged release-status text updated. Manager reran clean root and extension installs, 274 server tests, build, 7 packaging tests, full extension audit (0), and actual isolated VSIX protocol/extension-host checks on VS Code 1.90.2 and 1.138.0; all passed, including hover and applied Quick Fix. Updated VSIX SHA-256: `f4530cfcfc1fd147efaab94f80642781b440e92d292a2436c09bb4647be89b4c`. The workflow rebuilds and validates from the approved tag; ZIP metadata can change archive hashes without changing payloads. Marketplace verification remains a post-publication gate. No npm server or Zed release authorized.

The earlier local evidence below is historical; its uncommitted-state and artifact hash describe the earlier validation, not the final release.

## Earlier isolated validation — 2026-10-01

Candidate base: `c76200220729712d64457a12087db8c0c2b4d822` plus the uncommitted harness/documentation delta on `feat/vscode-release-final-checks`. This is **local validation**, not committed release provenance: no commit, merge, push, tag, publication, Marketplace download, or normal-profile installation occurred.

Artifact: `editors/vscode/design-system-language-server.vsix` (local ignored output), SHA-256 `1be2a0da658b166745b62732f05402064b445475fc37b33be5d64ee6c7e07090`.

- Fresh root `npm ci`, `npm test` (**274/274**), `npm run build`, and `npm run check:publishable` passed.
- Fresh `editors/vscode` `npm ci`, `npm run package` (including **7/7** package-policy tests and archive validation), and full `npm audit` (**0 vulnerabilities**) passed. The rebuilt candidate has 18 files.
- The current rebuilt VSIX passed the disposable protocol and extension-host smoke in installed VS Code **1.138.0** (`7debcd0e2acdea1c52de81bf9ee1620444407dda`). The run used harness-created `/tmp` user-data, extension, workspace, and extraction directories and installed only the VSIX.
- That run requests hover through the packaged server and VS Code's `vscode.executeHoverProvider`, then asserts the component, description, deprecation, and replacement content. It also awaits a disposable deprecated attribute-value diagnostic, requests `vscode.executeCodeActionProvider`, asserts the `quickfix` edit is exactly `legacy` → `modern`, applies its `WorkspaceEdit`, and asserts the disposable document changes. The protocol smoke independently asserts the corresponding LSP hover and code-action payloads.
- A single bounded retry with downloaded VS Code **1.90.2** (`5437499feb04f7a586f677b155b039bc2b3669eb`) passed all isolated protocol and extension-host assertions, including the current hover and Quick Fix assertions. It used the distribution's CLI launcher for install/list (`CODE_BINARY=/tmp/dsls-release-validation-c762002-20261001T221023Z/vscode-1.90.2/bin/code`) and its Electron executable for the extension host (`CODE_HOST_BINARY=/tmp/dsls-release-validation-c762002-20261001T221023Z/vscode-1.90.2/code`), with no existing process from that distribution and low system load before launch. Log: `/tmp/dsls-release-validation-c762002-20261001T221023Z/vscode-1.90.2-smoke-retry.log`.
- Root `npm audit` reports **5 pre-existing dev-only advisories** (3 moderate, 1 high, 1 critical) through Vitest/Vite. They are not shipped in the VSIX; no broad dependency upgrade was made in this focused validation.

## Release gates and limitations

This is functional provider evidence, **not visual acceptance**: hover or Quick Fix rendering/menu presentation was not manually accepted. Manual isolated VS Code rendering, additional platform coverage, multi-root workflow checks, and Marketplace installation/download remain unverified in this local record. Approval to tag/push/publish was granted on 2026-10-02.

The release workflow is **pre-release only**: its `vscode-v*` tag path packages and publishes with `--pre-release`; it has no stable-publication path. Manager rechecked GitHub directly: environment secret **`VSCE_PAT`** exists in **`vscode-marketplace`** (updated 2026-08-31); the earlier absence report was incorrect. Credential presence does not establish authentication validity. Magnus approved the 0.2.0 pre-release integration/tag/publication on 2026-10-02 with manual visual checks outstanding. The workflow must succeed and the Marketplace-delivered artifact must be verified before delivery is complete.

The final approved commit must be built and smoke-tested by the release workflow before publication. Record its tag/workflow and the Marketplace verification in the release task; local artifacts alone are not delivery evidence.

## Historical evidence (not current claims)

Earlier local validation and bundling notes, including prior hashes, baseline size comparisons, Zed experiments, and 2026-09-27 release-workflow observations, described earlier artifacts and runs. They are intentionally not evidence for this worktree's rebuilt VSIX; the current evidence is the 2026-10-01 section above.

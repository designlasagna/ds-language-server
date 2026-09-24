# RFC 0005 implementation review

Originally reviewed against commit `ea42de7`; reconciled with the uncommitted RFC follow-up work on 2026-09-23 and re-reconciled on 2026-09-24 after the Zed settings-forwarding regression fix, the CEM nested-status, lifecycle-profile, member-kind, and attribute/member-correlation corrections, and the Zed auto-distribution mechanism (branch `feat/zed-auto-distribution`). This is an implementation audit, not a proposal to restore every original presentation detail.

## Verdict

The language-server feature set described by the RFC is substantially implemented locally, including the configuration/recognition and component-API gaps identified by the original audit. RFC 0005 is **not fully delivered**: the current work is committed locally (unpushed) and awaiting human review, live editor acceptance has not been performed, Zed auto-distribution is implemented but gated on the release chain because the server package is unpublished, JetBrains integration is absent, and external design-system/publication claims have no evidence from this repository.

No feature deferral is approved. Open distribution and external work must remain open until implemented or explicitly approved for deferral.

## Baseline and current boundaries

- Baseline before this review: `ea42de7` (107 tests).
- Previously approved implementation checkpoints: automatic reload/watchers at `95da37a`; lifecycle integration at `5469338`.
- Recognition and component-API work described below is uncommitted.
- Lifecycle handling is schema-first: the legacy adapter is the default; CEM/DTCG use the local, unpublished schemas v0.4 contract only with `lifecycle.profile: "0.4"`; native token/utility manifests select it through `schemaVersion: "0.4.0"`.
- Lifecycle `status` is an arbitrary authored string. Only statuses with defined lifecycle meaning affect deprecation/removal behavior.
- Explicit `sources` are additive to package discovery unless `discovery.enabled` is false.
- Component hover intentionally stays compact: description, useful slot details, and actionable lifecycle guidance. Exhaustive attribute/package lists are not part of the current contract.
- Component replacement is diagnostic-only under the approved lifecycle contract; paired opening/closing tag rename actions are not promised.

## Implemented and validated locally

### Core server and lifecycle

- TypeScript stdio LSP with completion, hover, diagnostics, token-document schema diagnostics, and replacement code actions.
- Package discovery through `customElements` and `designSystem`, plus additive explicit component/token/utility sources.
- JSON, JS, and MJS workspace configuration with deterministic precedence, stale-source clearing, entry-module reload, overlap protection, and decoded workspace URIs. Imported JS helpers remain cached until restart.
- Capability-aware watches for config candidates, resolved/missing manifests, package metadata, and shallow package directories, with debouncing and metadata-polling fallback.
- CEM component/tag/attribute/value/slot support, token and utility formats, lifecycle propagation, status-only deprecation, time-aware severity, compact migration hovers, and safe token/utility/attribute replacement actions.

### Settings and recognition

- Effective precedence is built-in defaults → first workspace config (`ds.config.json`, `.js`, `.mjs`) → explicit editor overrides.
- Editor-overridable fields are `languages`, `templateTags.html`, `templateTags.css`, `classAttributes`, `diagnostics.deprecated`, and `diagnostics.packages.*.deprecated`. Arrays replace; `[]` disables that recognition list; nested settings merge; an empty editor snapshot resets the editor layer.
- `sources`, `discovery`, `lifecycle`, and `diagnostics.draftUsage` are file-only. Editor settings cannot opt a project into a lifecycle profile or alter manifests.
- VS Code forwards only explicitly configured values; Zed forwards settings through initialization options and workspace configuration, and the server unwraps the `dsLanguageServer` section from initialization and configuration responses (settings-forwarding regression, regression-tested). Server-side language gating is shared by completion, hover, and lifecycle diagnostics.
- JavaScript/TypeScript template recognition is lexical and limited to configured static tagged-template regions. JSX/TSX keeps static markup/class-template support; `templateTags` filtering does not currently govern JSX/TSX or framework script sections.
- Configurable class attributes and exact-source per-package severity are implemented, including safe handling of package names such as `__proto__` and `constructor`.

### Component APIs

- Lit `.property` and `@event` completion from eligible CEM fields/events.
- CEM nested `status` fields on attributes, members, slots, events, and CSS properties/parts participate in lifecycle normalization under the `0.4` profile; member `kind`, privacy, static, and readonly markers gate writable property suggestions (legacy members omitting `kind` are accepted).
- Static keys in direct Lit `classMap({...})` class-attribute interpolations participate in completion, hover, diagnostics, and safe replacement ranges.
- `::part()` completion for a single explicit custom-element selector in deliberately unambiguous CSS contexts.
- Component-scoped CSS custom properties merge with global token suggestions only when an explicit component rule establishes ownership; scoped entries win name collisions.

Precise positive and negative scopes are documented in [`../configuration-and-recognition.md`](../configuration-and-recognition.md).

## Partial, unimplemented, or externally unverified

| Area | Status |
|---|---|
| Live VS Code and Zed acceptance | Not performed. Automated stdio/client tests do not establish interactive editor behavior. |
| Zed wrapper | Native `cargo check --offline` passed. Automatic package installation is implemented on branch `feat/zed-auto-distribution` via Zed's native npm API (`npm_install_package`, `npm_package_latest_version`, `npm_package_installed_version`, `node_binary_path`), tracking the latest published server version by default with an optional `serverVersion` pin; `serverPath`/`nodePath` remain development overrides. `wasm32-wasip1` is unavailable and was not installed, and no live Zed session was performed. Until `@designlasagna/ds-language-server` is published on npm, the wrapper reports a clear installation failure instead of guessing. |
| JetBrains | No integration exists in this repository. |
| External systems | Acme build-pipeline integration and validation against Acme, Shoelace, Spectrum, or another external design system are unverified. Synthetic fixtures are not substitutes. |
| Publication | No docs-site, package, marketplace, release, push, or tag evidence was produced for this work. Existing local file dependencies still require authorized release preparation. |
| Performance | Synthetic benchmark only: 1,000 components, 10,000 tokens, 5,000 utilities and a 1,000-line document. Completion p95 reached 492.47 ms in runs recorded during implementation under load; a 2026-09-24 re-measurement on the current tree `fda345c` (upgraded 64 GB machine) recorded 46.40 ms p95. No acceptance threshold exists. Watcher polling and live-editor performance were not measured. |
| Parsing breadth | JS/TS/JSX/framework recognition remains lexical rather than AST-based. Inline-style and inferred `:host` ownership, ambiguous selectors, arbitrary class-producing expressions, computed/spread `classMap` keys, and imported aliases are intentionally not inferred by the current implementation. |

These are open facts, not approved deferrals.

## Validation — 2026-09-23

After recovery from the earlier systemd-oomd interruption:

- Focused component/recognition tests: **31 passed**.
- Focused configuration/severity tests: **36 passed**.
- Full suite: **269 passed across 19 files**.
- `npm run build`: passed.
- VS Code bundle build: passed.
- `node --check` for the VS Code extension and bundled server: passed.
- `cargo check --offline --manifest-path editors/zed/Cargo.toml`: passed natively.
- `git diff --check`: clean at validation time.

No live editor session, external design-system run, WASM build, release, or publication was part of that validation. See [`../rfc-0005-delivery-status.md`](../rfc-0005-delivery-status.md) for the evidence matrix and benchmark measurements.

## Revalidation — 2026-09-24 (current working tree)

After the 2026-09-24 memory upgrade, the Zed settings-forwarding regression fix, and the CEM nested-status, lifecycle-profile, member-kind, and attribute/member-correlation corrections:

- Full suite: **274/274 passed across 19 files**, including the final CEM attribute/member-correlation regression (kebab-case attributes ↔ camelCase members under the v0.4 profile).
- `npm run build`: passed.
- `node --check` for the VS Code extension and built server: passed.
- `cargo check --offline --manifest-path editors/zed/Cargo.toml`: passed natively.
- `git diff --check`: clean.

The 2026-09-23 numbers above remain the record of that specific post-recovery run; an intermediate 2026-09-24 run recorded 272/272 before the final CEM correlation regression was added. No live editor session, external design-system run, WASM build, release, or publication was part of this validation either.

## Outstanding decisions and work

1. Execute the Zed distribution release chain — publish `@designlasagna/schemas@0.4.0`, switch the DSLS `file:../schemas` dependency to `^0.4.0`, publish `@designlasagna/ds-language-server`, then register the extension in `zed-industries/extensions` (monorepo pin with `path = "editors/zed"`) — and verify live behavior in Zed. The wrapper mechanism is implemented on branch `feat/zed-auto-distribution`; if the chain is not approved, obtain explicit approval for a linked deferral.
2. Implement JetBrains integration, or obtain explicit approval for a linked deferral.
3. Perform live VS Code/Zed smoke tests and, if authorized, install/build the Zed WASM target.
4. Gather actual Acme/build-pipeline and third-party design-system evidence.
5. Prepare docs/package/editor publication separately and only with authorization.
6. Review completion tail latency and add polling/live-editor performance evidence if a threshold is required.

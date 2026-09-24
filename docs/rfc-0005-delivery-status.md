# RFC 0005 delivery evidence — historical snapshot (2026-09-23–24)

> [!note]
> This document preserves implementation evidence and open questions as they stood on 2026-09-24. It is not current release or editor-availability guidance. See the [README](../README.md) and editor setup documents for current installation information.

This is a local implementation record, not release or marketplace evidence. Claims below describe the recorded snapshot and are intentionally retained as historical evidence.

## Delivery matrix

| Area | Status | Evidence / remaining work |
|---|---|---|
| Configuration loading and automatic watching | Implemented; previously approved | Commit `95da37a`; JSON/JS/MJS, source changes, targeted registration, polling fallback, stdio tests |
| Lifecycle contract integration | Implemented; previously approved | Commit `5469338`; local schemas v0.4; native version selection, explicit CEM/DTCG opt-in, diagnostics, compact hovers, safe actions |
| Settings transport and configurable recognition | Implemented locally; final review pending | File/editor precedence, snapshots/resets, fetch races, VS Code explicit-value forwarding, Zed callbacks (settings-forwarding regression fixed and regression-tested), shared recognition and package severity tests |
| Lit member/event, parts, scoped CSS properties, classMap | Implemented locally; final review pending | Parser/provider tests and negative scope tests; exact supported contexts in `configuration-and-recognition.md` |
| Token-document v0.4 schema diagnostics | Integration correction implemented locally | Native version dispatch and explicit DTCG profile now reach schema validation; regression tests added |
| VS Code adapter build | Locally verified | Local bundle built; initialize/shutdown/exit smoke test succeeded with sibling schemas 0.4.0; mock adapter tests verify actual configuration middleware signature |
| Zed wrapper | Partially verified | Native `cargo check --offline` passed; automatic package installation implemented on branch `feat/zed-auto-distribution` (2026-09-24, host-side `cargo check` re-run after the change); WASM build remains blocked because no `wasm32-wasip*` target is installed (installation requires authorization); no live Zed session performed |
| Live VS Code/Zed behavior | Externally unverified | No interactive editor acceptance session performed; automated transport tests are not a substitute |
| Zed automatic distribution | Mechanism implemented; gated on the release chain (2026-09-24) | Wrapper now uses Zed's native npm API — `npm_package_latest_version`, `npm_package_installed_version`, `npm_install_package`, plus `node_binary_path` (Zed's bundled Node), following Zed's own HTML extension pattern; installation state is surfaced with `set_language_server_installation_status`; `serverPath`/`nodePath` remain development overrides and `serverVersion` pins an exact version. Remaining gates: publish `@designlasagna/schemas@0.4.0` (schemas `main` is one commit ahead of `origin/main`, push requires approval), switch `file:../schemas` → `^0.4.0` (guarded by `npm run check:publishable`), publish `@designlasagna/ds-language-server` (`publish-npm.yml`, provenance), then a registry PR to `zed-industries/extensions` pinning this monorepo with `path = "editors/zed"`. Integrity comes from npm's per-tarball integrity hashes plus Zed's bundled Node; GitHub Releases are no longer a prerequisite for Zed distribution |
| JetBrains integration | Not implemented; decision outstanding | No plugin implementation or approved deferral |
| External design-system/build-pipeline validation | Externally unverified | Synthetic fixtures do not verify Acme, Shoelace, Spectrum or their pipelines |
| Documentation site / marketplace / release publication | Externally unverified for these changes | No push, tag, package or extension publication performed; `publish-npm.yml` and the publish guard are in place but inert until the local `file:../schemas` dependency is replaced during authorized release preparation |
| Scale/performance | Synthetic evidence only | Reproducible script below; the 2026-09-24 re-measurement on the current tree does not reproduce the previously recorded completion tail (~46 ms p95 vs ~250–492 ms recorded during implementation under load); watcher polling and editor performance remain unmeasured |

No feature deferral is approved by this document. The outstanding distribution/integration items remain open rather than being declared complete.

## Validation and OOM recovery

The final post-recovery validation pass completed on 2026-09-23:

- Focused component/recognition tests: **31 passed**.
- Focused configuration/severity tests: **36 passed**, including prototype-named package severity entries.
- Full suite: **269 passed across 19 files**.
- TypeScript build and VS Code bundle build: passed.
- `node --check` for `editors/vscode/extension.js` and the bundled server: passed.
- Native `cargo check --offline --manifest-path editors/zed/Cargo.toml`: passed.
- `git diff --check`: clean at validation time.

At **08:58–08:59 CEST**, before that successful pass, systemd-oomd killed desktop/tmux scopes because RAM and swap exceeded its threshold. The interrupted run had last confirmed **263 tests passing** and a successful TypeScript build; it was not treated as final validation. Working-tree changes survived. With Magnus's approval, the local `qwen-mtp-long` service was stopped and was not restarted after the incident. Memory headroom recovered, allowing the 269-test validation above. This preserves the interruption history without treating the OOM-blocked run as success.

## Revalidation after the 2026-09-24 memory upgrade

On 2026-09-24 the machine was upgraded to 64 GB of RAM. The local `qwen-mtp-long` service was already running, and its health check passed. The first full local revalidation completed that day: full suite 269/269 across 19 files, TypeScript build, `node --check` adapter syntax check, native `cargo check --offline`, and `git diff --check` all clean; 52 GiB of memory available after the run.

After the Zed settings-forwarding regression fix and the CEM nested-status, lifecycle-profile, member-kind, and attribute/member-correlation corrections, a final local validation of the current working tree:

- Full suite: **274/274 passed across 19 files**, including the final CEM attribute/member-correlation regression (kebab-case attributes ↔ camelCase members under the v0.4 profile).
- TypeScript build: passed.
- `node --check` adapter syntax check: passed.
- Native `cargo check --offline --manifest-path editors/zed/Cargo.toml`: passed.
- `git diff --check`: clean.

## Reproducible synthetic benchmark

```sh
npm run build
node scripts/benchmark.mjs
```

Fixtures: 1,000 components (three attributes each), 10,000 tokens, 5,000 utilities, and a 1,000-line / 68,559-character document. Two warmups and ten timed iterations; fixtures are temporary and cleaned up. All identifiers are active/known, so diagnostic count is zero. The script measures the scan path, not a large volume of emitted diagnostics.

Historical runs, recorded on the original pre-upgrade hardware (Linux x64, Node v25.1.0, Intel Core i7-6700K) during implementation, under then-current machine load and an earlier implementation state:

| Metric | Run 1 | Run 2 |
|---|---:|---:|
| Store load | 68.19 ms | 37.70 ms |
| Diagnostics median / p95 | 5.76 / 60.30 ms | 5.16 / 9.48 ms |
| Completion median / p95 | 38.80 / 249.73 ms | 61.90 / 492.47 ms |
| Hover median / p95 | 0.67 / 5.88 ms | 0.68 / 12.67 ms |
| Heap used snapshot | 29.37 MB | 66.86 MB |

Re-measured 2026-09-24 on the upgraded 64 GB machine (same CPU, Node v25.1.0) against the current committed tree `fda345c`:

| Metric | 2026-09-24 re-run |
|---|---:|
| Store load | 37.46 ms |
| Diagnostics median / p95 | 5.33 / 10.06 ms |
| Completion median / p95 | 39.67 / 46.40 ms |
| Hover median / p95 | 1.62 / 11.01 ms |
| Heap used snapshot | 29.02 MB |

The two sets are not directly comparable: the historical runs predate the final implementation slices and were captured under different machine load (including the OOM incident period). The re-measurement records the current local baseline; it does not establish an acceptance threshold or imply editor responsiveness.

Completion materializes approximately 10,000 matching items. With only ten samples, p95 is near the maximum and sensitive to GC/JIT and machine load. These are observations, not latency guarantees or a performance acceptance threshold. In particular, the ~492 ms completion tail is not evidence that every interaction is fast.

## Next checks

1. Finish human review of recognition and component API slices (tasks remain `doing`, ready for review).
2. Perform live VS Code/Zed smoke tests; install/build the WASM target only with authorization.
3. Execute the Zed distribution release chain (schemas publish → dependency switch → DSLS npm publish → registry PR) and then perform live Zed verification; resolve JetBrains integration or explicitly approve a linked deferral. The Zed auto-install mechanism itself is implemented; the release chain remains the gate, and nothing is deferred without approval.
4. Gather actual Acme/build-pipeline and external design-system validation rather than inferring it from fixtures.
5. Prepare docs/package/editor publication separately, replacing local dependencies only after schemas publication is authorized.
6. Decide whether completion tail latency, watcher polling, and live-editor performance need acceptance thresholds and further measurement.

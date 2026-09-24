#!/usr/bin/env node
/**
 * Reproducible local synthetic benchmark for the built dist of ds-language-server.
 *
 * NOTE: synthetic workload only — NOT evidence of live editor or external-system
 * performance. No pass/fail timing threshold; numbers are for local comparison.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DSStore } from '../dist/store.js';
import { getDiagnostics } from '../dist/providers/diagnostics.js';
import { getCompletions } from '../dist/providers/completion.js';
import { getCursorContext } from '../dist/scanner.js';
import { getHover } from '../dist/providers/hover.js';

const N_COMPONENTS = 1000, N_TOKENS = 10000, N_UTILITIES = 5000, N_LINES = 1000;
const WARMUPS = 2, ITERS = 10;
const r2 = x => Math.round(x * 100) / 100;
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p95 = a => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]; };
const run = (fn, iters) => { const t = []; for (let i = 0; i < iters; i++) { const a = performance.now(); fn(); t.push(performance.now() - a); } return t; };

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ds-bench-'));
try {
  // ── Synthetic fixtures in tmp dir ────────────────────────────────────
  const cemJson = JSON.stringify({ schemaVersion: '1.0.0', modules: [{ path: 'bench.js', declarations:
    Array.from({ length: N_COMPONENTS }, (_, i) => ({
      tagName: `bench-${i}`, name: `Bench${i}`, description: `Synthetic component ${i}`,
      attributes: [
        { name: 'size', type: 'string', enum: ['sm', 'md', 'lg'] },
        { name: 'variant', type: 'string' },
        { name: 'disabled', type: 'boolean', default: false },
      ],
    })) }] });
  const tokensJson = JSON.stringify({ name: 'bench-tokens', tokens:
    Array.from({ length: N_TOKENS }, (_, i) =>
      ({ id: `bench.${i}`, cssVariable: `--bench-${i}`, type: 'dimension', resolved: { base: '1px' } })) });
  const utilitiesJson = JSON.stringify({ utilities:
    Array.from({ length: N_UTILITIES }, (_, i) => ({ name: `u-${i}`, description: `Synthetic utility ${i}` })) });
  const f = (name, json) => { const p = path.join(tmp, name); writeFileSync(p, json); return p; };

  // ── DSStore.load with actual sources, packageName 'bench' ────────────
  const store = new DSStore();
  const t0 = performance.now();
  store.load({
    components: [{ path: f('components.json', cemJson), packageName: 'bench' }],
    tokens: [{ path: f('tokens.json', tokensJson), packageName: 'bench' }],
    utilities: [{ path: f('utilities.json', utilitiesJson), packageName: 'bench' }],
  });
  const loadMs = performance.now() - t0;
  const stats = store.stats();
  if (stats.components !== N_COMPONENTS || stats.tokens !== N_TOKENS || stats.utilities !== N_UTILITIES)
    throw new Error(`unexpected store stats: ${JSON.stringify(stats)}`);

  // ── Document: N_LINES repetitions, identifiers modulo counts ─────────
  const docText = Array.from({ length: N_LINES }, (_, i) =>
    `<bench-${i % N_COMPONENTS} class="u-${i % N_UTILITIES}" style="color:var(--bench-${i % N_TOKENS})"></bench-${i % N_COMPONENTS}>`).join('\n');
  const doc = TextDocument.create('file:///benchmark.html', 'html', 1, docText);

  // ── Diagnostics: warmups, then ITERS measured runs ────────────────────
  for (let i = 0; i < WARMUPS; i++) getDiagnostics(doc, store);
  const diagTimes = run(() => getDiagnostics(doc, store), ITERS);
  const diagCount = getDiagnostics(doc, store).length;

  // ── Completion: css-var prefix '--bench-' via the getCompletions dispatcher ──
  const probeText = '<bench-1 style="color:var(--bench-)"></bench-1>';
  const probe = TextDocument.create('file:///probe.html', 'html', 1, probeText);
  const probeOffset = probeText.indexOf('--bench-') + '--bench-'.length; // cursor right after the prefix
  const context = getCursorContext(probe, probeOffset);
  if (context.kind !== 'css-var' || context.prefix !== '--bench-')
    throw new Error(`unexpected cursor context: ${JSON.stringify(context)}`);
  const completion = () => getCompletions(getCursorContext(probe, probeOffset), store);
  for (let i = 0; i < WARMUPS; i++) completion();
  const completionTimes = run(() => { if (!completion().length) throw new Error('no css-var completions'); }, ITERS);
  const completionSample = completion()[0]?.label;

  // ── Hover (easy variant): cursor inside var(--bench-0) on line 0 ─────
  const varPos = doc.positionAt(docText.indexOf('--bench-0') + 3);
  for (let i = 0; i < WARMUPS; i++) getHover(doc, varPos, store);
  const hoverTimes = run(() => getHover(doc, varPos, store), ITERS);
  const hoverFound = getHover(doc, varPos, store) !== null;

  // ── Report ────────────────────────────────────────────────────────────
  console.log(JSON.stringify({
    note: 'Synthetic local benchmark of built dist — not live editor or external-system evidence. No pass/fail timing threshold.',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: { model: os.cpus()[0].model, cores: os.cpus().length },
    counts: { components: N_COMPONENTS, tokens: N_TOKENS, utilities: N_UTILITIES, documentLines: N_LINES, warmups: WARMUPS, iterations: ITERS },
    inputChars: { components: cemJson.length, tokens: tokensJson.length, utilities: utilitiesJson.length, document: docText.length },
    loadMs: r2(loadMs),
    diagnostics: { medianMs: r2(median(diagTimes)), p95Ms: r2(p95(diagTimes)), count: diagCount },
    completion: { medianMs: r2(median(completionTimes)), p95Ms: r2(p95(completionTimes)), prefix: '--bench-', sampleItem: completionSample },
    hover: { medianMs: r2(median(hoverTimes)), p95Ms: r2(p95(hoverTimes)), found: hoverFound },
    heapUsedMB: r2(process.memoryUsage().heapUsed / 1048576),
  }, null, 2));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ManifestSources, ManifestFile, DSConfig } from './types.js';

/**
 * Discover design system manifests.
 *
 * Two sources of manifests, merged together:
 * 1. Auto-discovery — scans node_modules for packages with "customElements" or "designSystem" fields
 * 2. Explicit sources — paths listed in ds.config.json "sources"
 *
 * Config controls:
 * - `sources` — additional manifest files (always merged with auto-discovered)
 * - `discovery.enabled` — set to false to disable node_modules scanning (default: true)
 * - `discovery.packages` — allowlist of package names to scan (default: all)
 */
export function discoverManifests(
  workspaceRoot: string,
  config?: DSConfig,
): ManifestSources {
  const sources: ManifestSources = {
    components: [],
    tokens: [],
    utilities: [],
  };

  // 1. Auto-discovery from node_modules (unless disabled)
  const discoveryEnabled = config?.discovery?.enabled !== false;

  if (discoveryEnabled) {
    const nodeModules = path.join(workspaceRoot, 'node_modules');
    if (fs.existsSync(nodeModules)) {
      const allowlist = config?.discovery?.packages;
      scanDirectory(nodeModules, sources, allowlist);
    }
  }

  // 2. Merge explicit sources from config
  if (config?.sources) {
    addExplicitSources(config.sources.components, sources.components, workspaceRoot);
    addExplicitSources(config.sources.tokens, sources.tokens, workspaceRoot);
    addExplicitSources(config.sources.utilities, sources.utilities, workspaceRoot);
  }

  return sources;
}

function addExplicitSources(
  paths: string[] | undefined,
  target: ManifestFile[],
  workspaceRoot: string,
): void {
  if (!paths) return;

  for (const p of paths) {
    const abs = path.resolve(workspaceRoot, p);
    if (fs.existsSync(abs)) {
      // Avoid duplicates (same file already found via auto-discovery)
      if (!target.some((f) => f.path === abs)) {
        target.push({ path: abs, packageName: 'config' });
      }
    }
  }
}

function scanDirectory(
  nodeModulesDir: string,
  sources: ManifestSources,
  allowlist?: string[],
): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(nodeModulesDir);
  } catch {
    return;
  }

  // Build a Set for fast allowlist lookups
  const allowed = allowlist ? new Set(allowlist) : undefined;

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;

    const entryPath = path.join(nodeModulesDir, entry);

    if (entry.startsWith('@')) {
      // Scoped package — recurse into scope directory
      let scopedEntries: string[];
      try {
        scopedEntries = fs.readdirSync(entryPath);
      } catch {
        continue;
      }
      for (const scopedEntry of scopedEntries) {
        const packageName = `${entry}/${scopedEntry}`;
        if (allowed && !allowed.has(packageName)) continue;

        const pkgDir = path.join(entryPath, scopedEntry);
        scanPackage(pkgDir, packageName, sources);
      }
    } else {
      if (allowed && !allowed.has(entry)) continue;

      scanPackage(entryPath, entry, sources);
    }
  }
}

function scanPackage(
  pkgDir: string,
  packageName: string,
  sources: ManifestSources,
): void {
  const pkgJsonPath = path.join(pkgDir, 'package.json');

  let pkgJson: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(pkgJsonPath, 'utf-8');
    pkgJson = JSON.parse(raw);
  } catch {
    return;
  }

  // Check for "customElements" field (standard CEM)
  if (typeof pkgJson.customElements === 'string') {
    const cemPath = path.resolve(pkgDir, pkgJson.customElements);
    if (fs.existsSync(cemPath)) {
      sources.components.push({ path: cemPath, packageName });
    }
  }

  // Check for "designSystem" field
  const ds = pkgJson.designSystem;
  if (ds && typeof ds === 'object') {
    const dsObj = ds as Record<string, unknown>;

    if (typeof dsObj.tokens === 'string') {
      const tokensPath = path.resolve(pkgDir, dsObj.tokens);
      if (fs.existsSync(tokensPath)) {
        sources.tokens.push({ path: tokensPath, packageName });
      }
    }

    if (typeof dsObj.utilities === 'string') {
      const utilitiesPath = path.resolve(pkgDir, dsObj.utilities);
      if (fs.existsSync(utilitiesPath)) {
        sources.utilities.push({ path: utilitiesPath, packageName });
      }
    }
  }
}

/**
 * Try to load a ds.config.js or ds.config.json from the workspace root.
 */
export async function loadConfig(workspaceRoot: string): Promise<DSConfig | undefined> {
  // Try JSON first
  const jsonPath = path.join(workspaceRoot, 'ds.config.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      return JSON.parse(raw) as DSConfig;
    } catch {
      return undefined;
    }
  }

  // Try JS/MJS
  for (const ext of ['ds.config.js', 'ds.config.mjs']) {
    const jsPath = path.join(workspaceRoot, ext);
    if (fs.existsSync(jsPath)) {
      try {
        const mod = await import(`file://${jsPath}`);
        return (mod.default ?? mod) as DSConfig;
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

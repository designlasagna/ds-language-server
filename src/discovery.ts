import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ManifestSources, ManifestFile, DSConfig } from './types.js';

/**
 * Discover design system manifests by scanning node_modules.
 *
 * Looks for:
 * - "customElements" in package.json → CEM path
 * - "designSystem.tokens" in package.json → token manifest path
 * - "designSystem.utilities" in package.json → utility manifest path
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

  // If explicit sources are configured, use those
  if (config?.sources) {
    if (config.sources.components) {
      for (const p of config.sources.components) {
        const abs = path.resolve(workspaceRoot, p);
        if (fs.existsSync(abs)) {
          sources.components.push({ path: abs, packageName: 'config' });
        }
      }
    }
    if (config.sources.tokens) {
      for (const p of config.sources.tokens) {
        const abs = path.resolve(workspaceRoot, p);
        if (fs.existsSync(abs)) {
          sources.tokens.push({ path: abs, packageName: 'config' });
        }
      }
    }
    if (config.sources.utilities) {
      for (const p of config.sources.utilities) {
        const abs = path.resolve(workspaceRoot, p);
        if (fs.existsSync(abs)) {
          sources.utilities.push({ path: abs, packageName: 'config' });
        }
      }
    }

    // If any explicit sources found, skip auto-discovery
    if (sources.components.length || sources.tokens.length || sources.utilities.length) {
      return sources;
    }
  }

  // Auto-discovery: scan node_modules
  const nodeModules = path.join(workspaceRoot, 'node_modules');
  if (!fs.existsSync(nodeModules)) return sources;

  scanDirectory(nodeModules, sources);

  return sources;
}

function scanDirectory(nodeModulesDir: string, sources: ManifestSources): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(nodeModulesDir);
  } catch {
    return;
  }

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
        const pkgDir = path.join(entryPath, scopedEntry);
        scanPackage(pkgDir, `${entry}/${scopedEntry}`, sources);
      }
    } else {
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

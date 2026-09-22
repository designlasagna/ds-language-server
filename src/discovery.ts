import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { ManifestSources, ManifestFile, DSConfig } from './types.js';

const requireConfig = createRequire(import.meta.url);
let importVersion = 0;
const CONFIG_CANDIDATES = ['ds.config.json', 'ds.config.js', 'ds.config.mjs'] as const;

export interface DiscoveryWatchTargets {
  /** Files whose creation, removal, or modification can change discovery. */
  files: string[];
  /** Directories whose children can change the set of discovered packages. */
  directories: string[];
}

export interface DiscoveryResult {
  /** Manifest files that currently exist. */
  sources: ManifestSources;
  /** Existing and potential inputs that can change a subsequent result. */
  watchTargets: DiscoveryWatchTargets;
}

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
  return discover(workspaceRoot, config).sources;
}

/**
 * Discover current manifest sources and every path that can affect discovery.
 * Potential files are retained even when absent so a watcher can observe their
 * creation without performing a second traversal.
 */
export function discover(workspaceRoot: string, config?: DSConfig): DiscoveryResult {
  const sources: ManifestSources = {
    components: [],
    tokens: [],
    utilities: [],
  };
  const files = new Set<string>();
  const directories = new Set<string>();

  for (const candidate of CONFIG_CANDIDATES) {
    files.add(path.join(workspaceRoot, candidate));
  }
  files.add(path.join(workspaceRoot, 'package.json'));

  // 1. Auto-discovery from node_modules (unless disabled)
  if (config?.discovery?.enabled !== false) {
    scanDirectory(
      path.join(workspaceRoot, 'node_modules'),
      sources,
      files,
      directories,
      config?.discovery?.packages,
    );
  }

  // 2. Merge explicit sources from config
  if (config?.sources) {
    addExplicitSources(config.sources.components, sources.components, workspaceRoot, files);
    addExplicitSources(config.sources.tokens, sources.tokens, workspaceRoot, files);
    addExplicitSources(config.sources.utilities, sources.utilities, workspaceRoot, files);
  }

  return {
    sources,
    watchTargets: {
      files: [...files],
      directories: [...directories],
    },
  };
}

function addExplicitSources(
  paths: string[] | undefined,
  target: ManifestFile[],
  workspaceRoot: string,
  watchFiles: Set<string>,
): void {
  if (!paths) return;

  for (const p of paths) {
    const abs = path.resolve(workspaceRoot, p);
    watchFiles.add(abs);
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
  watchFiles: Set<string>,
  watchDirectories: Set<string>,
  allowlist?: string[],
): void {
  const allowed = allowlist ? new Set(allowlist) : undefined;
  if (!allowed || allowed.size > 0) watchDirectories.add(nodeModulesDir);

  // Allowlisted scopes are targets even before the scope itself exists.
  if (allowed) {
    for (const packageName of allowed) {
      if (packageName.startsWith('@') && packageName.includes('/')) {
        watchDirectories.add(path.join(nodeModulesDir, packageName.slice(0, packageName.indexOf('/'))));
      }
    }
  }

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
      if (allowed && ![...allowed].some((name) => name.startsWith(`${entry}/`))) continue;

      // A scope directory must be watched for package additions and removals.
      watchDirectories.add(entryPath);
      let scopedEntries: string[];
      try {
        scopedEntries = fs.readdirSync(entryPath);
      } catch {
        continue;
      }
      for (const scopedEntry of scopedEntries) {
        const packageName = `${entry}/${scopedEntry}`;
        if (allowed && !allowed.has(packageName)) continue;

        scanPackage(path.join(entryPath, scopedEntry), packageName, sources, watchFiles);
      }
    } else {
      if (allowed && !allowed.has(entry)) continue;

      scanPackage(entryPath, entry, sources, watchFiles);
    }
  }
}

function scanPackage(
  pkgDir: string,
  packageName: string,
  sources: ManifestSources,
  watchFiles: Set<string>,
): void {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  watchFiles.add(pkgJsonPath);

  let pkgJson: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(pkgJsonPath, 'utf-8');
    pkgJson = JSON.parse(raw);
  } catch {
    return;
  }

  addDeclaredSource(pkgJson.customElements, sources.components, pkgDir, packageName, watchFiles);

  const ds = pkgJson.designSystem;
  if (ds && typeof ds === 'object') {
    const dsObj = ds as Record<string, unknown>;
    addDeclaredSource(dsObj.tokens, sources.tokens, pkgDir, packageName, watchFiles);
    addDeclaredSource(dsObj.utilities, sources.utilities, pkgDir, packageName, watchFiles);
  }
}

function addDeclaredSource(
  declaredPath: unknown,
  target: ManifestFile[],
  pkgDir: string,
  packageName: string,
  watchFiles: Set<string>,
): void {
  if (typeof declaredPath !== 'string') return;

  const manifestPath = path.resolve(pkgDir, declaredPath);
  watchFiles.add(manifestPath);
  if (fs.existsSync(manifestPath)) target.push({ path: manifestPath, packageName });
}

/**
 * Load the highest-precedence config in the workspace (JSON, then JS, then MJS).
 * The config module itself is cache-busted so edits are visible on every call.
 */
export async function loadConfig(workspaceRoot: string): Promise<DSConfig | undefined> {
  const configName = CONFIG_CANDIDATES.find((name) => fs.existsSync(path.join(workspaceRoot, name)));
  if (!configName) {
    console.error('[ds-ls] No configuration file found; using defaults');
    return undefined;
  }

  const configPath = path.join(workspaceRoot, configName);
  try {
    let config: unknown;
    if (configName.endsWith('.json')) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else if (configName.endsWith('.mjs')) {
      config = unwrapDefault(await importFresh(configPath));
    } else {
      config = unwrapDefault(await loadFreshJs(configPath));
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('configuration must export an object');
    }

    console.error(`[ds-ls] Loaded ${configName}`);
    return config as DSConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ds-ls] Failed to load ${configName}: ${message}`);
    return undefined;
  }
}

async function loadFreshJs(configPath: string): Promise<unknown> {
  // Modern Node can require synchronous ESM, but that populates the ESM cache,
  // which delete require.cache cannot clear. Select the loader from the package
  // scope instead so every ESM load gets a cache-busting URL. This also handles
  // ESM configs with top-level await on Node versions where require rejects them.
  if (isEsModuleJs(configPath)) return importFresh(configPath);

  const resolved = requireConfig.resolve(configPath);
  delete requireConfig.cache[resolved];
  return requireConfig(resolved);
}

function isEsModuleJs(configPath: string): boolean {
  let directory = path.dirname(fs.realpathSync(configPath));
  while (true) {
    const packagePath = path.join(directory, 'package.json');
    if (fs.existsSync(packagePath)) {
      const packageJson: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      return typeof packageJson === 'object'
        && packageJson !== null
        && 'type' in packageJson
        && packageJson.type === 'module';
    }

    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

function importFresh(configPath: string): Promise<unknown> {
  const url = pathToFileURL(configPath);
  url.searchParams.set('ds-ls-reload', String(++importVersion));
  return import(url.href);
}

function unwrapDefault(value: unknown): unknown {
  if (value && typeof value === 'object' && 'default' in value) {
    return (value as { default: unknown }).default;
  }
  return value;
}

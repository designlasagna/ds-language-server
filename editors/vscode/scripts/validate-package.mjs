#!/usr/bin/env node
/**
 * Packaging guard for the VS Code extension.
 *
 * Archive policy: the generated entry points (client/extension.cjs,
 * server/server.js), the extension manifest/docs/icon/licenses (including
 * the generated licenses/THIRD-PARTY-NOTICES.md), and only the server
 * bundle's external runtime dependency closure (@designlasagna/schemas).
 * ajv, ajv-formats, jsonc-parser, and the client's vscode-languageclient
 * closure are compiled into the generated entry points, so their code must
 * not ship from node_modules and their license notices are retained in the
 * generated notices file. Every closure is derived from the bundle build
 * scripts and the lockfile, so a package is never assumed client-only (or
 * server-only) because of its name.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_SPEC = /^(?:file|link|workspace):|^(?:\.{1,2}[\\/]|~[\\/]|[\\/])|^[A-Za-z]:[\\/]/i;

/** Generated entry points. The client bundle is built from extension.js. */
export const GENERATED_ENTRY_POINTS = ['client/extension.cjs', 'server/server.js'];

/** The six schema documents the server loads directly, including the lifecycle schema the v0.4 documents $ref. */
export const REQUIRED_SCHEMAS = [
  'node_modules/@designlasagna/schemas/v0.3/tokens.json',
  'node_modules/@designlasagna/schemas/v0.3/dtcg-extensions.json',
  'node_modules/@designlasagna/schemas/v0.4/lifecycle.json',
  'node_modules/@designlasagna/schemas/v0.4/tokens.json',
  'node_modules/@designlasagna/schemas/v0.4/dtcg-extensions.json',
  'node_modules/@designlasagna/schemas/dtcg/2025.10/format.json',
];

/** Generated third-party license notices, derived from the lockfile closure. */
export const NOTICES_PATH = 'licenses/THIRD-PARTY-NOTICES.md';

/** Files vsce itself writes into the archive (not part of the source tree). */
const KNOWN_ARCHIVE_FILES = new Set([
  'extension.vsixmanifest',
  '[Content_Types].xml',
  'extension/package.json',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/LICENSE.txt',
  'extension/icon.png',
  `extension/${NOTICES_PATH}`,
]);

export function validateManifestAndLock(pkg, lock) {
  const problems = [];
  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (typeof spec !== 'string' || LOCAL_SPEC.test(spec)) {
        problems.push(`${section} dependency "${name}" uses a local reference (${spec})`);
      }
    }
  }

  for (const [packagePath, entry] of Object.entries(lock.packages ?? {})) {
    if (entry.link === true) {
      problems.push(`lockfile package "${packagePath || '<root>'}" is a symlink`);
    }
    if (typeof entry.resolved === 'string' && LOCAL_SPEC.test(entry.resolved)) {
      problems.push(`lockfile package "${packagePath || '<root>'}" resolves locally (${entry.resolved})`);
    }
  }
  return problems;
}

export function productionPackagePaths(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([packagePath, entry]) => packagePath.startsWith('node_modules/') && entry.dev !== true)
    .map(([packagePath]) => packagePath)
    .sort();
}

/**
 * Names of the packages the server bundle leaves external. The
 * bundle-server build script is the single source of truth.
 */
export function serverExternalRoots(pkg) {
  const script = pkg.scripts?.['bundle-server'] ?? '';
  const roots = new Set();
  for (const match of script.matchAll(/--external:([A-Za-z0-9@][A-Za-z0-9@./-]*)/g)) {
    roots.add(match[1]);
  }
  return [...roots].sort();
}

/**
 * Transitive production dependency closure of the server externals,
 * resolved against the lockfile (handles both hoisted and nested paths).
 */
export function serverDependencyClosure(pkg, lock) {
  const packages = lock.packages ?? {};
  const closure = new Set();
  const queue = serverExternalRoots(pkg).map((name) => `node_modules/${name}`);
  const queued = new Set(queue);
  while (queue.length) {
    const packagePath = queue.shift();
    const entry = packages[packagePath];
    if (!entry) continue;
    closure.add(packagePath);
    const deps = { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) };
    for (const name of Object.keys(deps)) {
      const nested = `${packagePath}/node_modules/${name}`;
      const candidate = packages[nested] ? nested : `node_modules/${name}`;
      if (!queued.has(candidate)) {
        queued.add(candidate);
        queue.push(candidate);
      }
    }
  }
  return [...closure].sort();
}

/** Package name of a lockfile path such as node_modules/a/node_modules/b/c. */
function packageNameOf(packagePath) {
  const tail = packagePath.slice(packagePath.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const segments = tail.split('/');
  return segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/**
 * Names of the production packages whose code is compiled into the generated
 * entry points: every production dependency except the server externals.
 */
export function bundledDependencyNames(pkg, lock) {
  const externals = new Set(serverExternalRoots(pkg));
  const names = new Set();
  for (const packagePath of productionPackagePaths(lock)) {
    const name = packageNameOf(packagePath);
    if (!externals.has(name)) names.add(name);
  }
  return [...names].sort();
}

/**
 * Shipped dependency closure for license notices, straight from the lockfile:
 * every production package ships inside the archive (bundled into an entry
 * point or installed from node_modules), so every one needs a retained
 * notice. Deterministic ordering by name, then path.
 */
export function shippedClosureEntries(lock) {
  return productionPackagePaths(lock)
    .map((packagePath) => {
      const entry = (lock.packages ?? {})[packagePath];
      return {
        packagePath,
        name: packageNameOf(packagePath),
        version: entry.version,
        license: entry.license,
      };
    })
    .sort((a, b) => (a.name === b.name ? a.packagePath.localeCompare(b.packagePath) : a.name.localeCompare(b.name)));
}

const LICENSE_FILE_NAMES = [
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'License.txt', 'COPYING', 'COPYING.md', 'UNLICENSE',
];

/** Name of the license notice file in a package directory, if any. */
export function licenseFileIn(packageDir) {
  if (!existsSync(packageDir) || !statSync(packageDir).isDirectory()) return null;
  const names = readdirSync(packageDir);
  for (const name of LICENSE_FILE_NAMES) {
    if (names.includes(name)) return name;
  }
  return names.sort().find((name) => /^licen[cs]e|^copying|^unlicense/i.test(name)) ?? null;
}

/**
 * Render the notices document. `entries` are shippedClosureEntries with a
 * `text` field holding the retained license text.
 */
export function renderNotices(entries) {
  const names = entries.map((entry) => entry.name);
  const lines = [
    '# Third-party notices',
    '',
    'Generated by `scripts/generate-notices.mjs` from `package-lock.json`; do not edit by hand.',
    '',
    'Every production dependency of this extension ships inside the archive: either',
    'compiled into `client/extension.cjs` / `server/server.js` or installed as an external',
    'runtime package. The retained license notice for each one follows.',
    '',
  ];
  for (const entry of entries) {
    const heading = `${entry.name} ${entry.version} — ${entry.license ?? 'unknown license'}`;
    lines.push(
      `## ${names.filter((name) => name === entry.name).length > 1 ? `${heading} (${entry.packagePath})` : heading}`,
      '',
      '```',
      entry.text.replace(/\r\n?/g, '\n').trimEnd(),
      '```',
      '',
    );
  }
  return lines.join('\n');
}

/**
 * A generated bundle must not require a bundled dependency by name at
 * runtime; only the server externals (and `vscode` for the client) may be
 * required from the archive.
 */
export function bundledRequireProblems(bundleText, pkg, lock) {
  const problems = [];
  for (const name of bundledDependencyNames(pkg, lock)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`require\\(\\s*["']${escaped}["']\\s*\\)`).test(bundleText)) {
      problems.push(`bundle still requires bundled dependency "${name}" at runtime`);
    }
  }
  return problems;
}

export function requiredArchivePaths(pkg, lock) {
  const paths = new Set(GENERATED_ENTRY_POINTS.map((file) => `extension/${file}`));
  paths.add(`extension/${NOTICES_PATH}`);
  for (const schema of REQUIRED_SCHEMAS) paths.add(`extension/${schema}`);
  for (const packagePath of serverDependencyClosure(pkg, lock)) {
    paths.add(`extension/${packagePath}/package.json`);
  }
  return [...paths].sort();
}

function missingLicenseProblems(closure, present) {
  const problems = [];
  for (const packagePath of closure) {
    if (!LICENSE_FILE_NAMES.some((name) => present(`extension/${packagePath}/${name}`))) {
      problems.push(`VSIX is missing the license notice for "${packagePath}"`);
    }
  }
  return problems;
}

export function validateArchiveEntries(entries, pkg, lock) {
  const present = new Set(entries);
  const closure = new Set(serverDependencyClosure(pkg, lock));
  const allowedRuntimeFiles = new Set(requiredArchivePaths(pkg, lock));
  for (const packagePath of closure) {
    for (const name of LICENSE_FILE_NAMES) {
      allowedRuntimeFiles.add(`extension/${packagePath}/${name}`);
    }
  }
  const problems = requiredArchivePaths(pkg, lock)
    .filter((file) => !present.has(file))
    .map((file) => `VSIX is missing runtime artifact "${file}"`);
  problems.push(...missingLicenseProblems([...closure], (file) => present.has(file)));

  for (const entry of [...present].sort()) {
    if (/\.(ts|tsx)$/.test(entry)) {
      problems.push(`VSIX contains TypeScript source "${entry}"`);
    }
    if (entry.startsWith('extension/node_modules/')) {
      const relative = entry.slice('extension/node_modules/'.length);
      const segments = relative.split('/');
      if (segments.length < 2) continue;
      const name = segments[0].startsWith('@')
        ? segments.slice(0, 2).join('/')
        : segments[0];
      if (!closure.has(`node_modules/${name}`) || !allowedRuntimeFiles.has(entry)) {
        problems.push(`VSIX contains unexpected runtime artifact "${entry}"`);
      }
    } else if (entry.startsWith('extension/')) {
      const relative = entry.slice('extension/'.length);
      if (
        !KNOWN_ARCHIVE_FILES.has(entry)
        && !GENERATED_ENTRY_POINTS.includes(relative)
      ) {
        problems.push(`VSIX contains unexpected artifact "${entry}"`);
      }
    } else if (!KNOWN_ARCHIVE_FILES.has(entry)) {
      problems.push(`VSIX contains unexpected artifact "${entry}"`);
    }
  }
  return problems.sort();
}

/**
 * Resolve the retained license text for every shipped package from the
 * installed node_modules tree. Pure apart from reading installed packages;
 * the lockfile alone is the source of name/version/license id.
 */
export function shippedClosureWithText(lock) {
  const problems = [];
  const entries = shippedClosureEntries(lock).map((entry) => {
    const packageDir = path.join(extensionRoot, entry.packagePath);
    if (!existsSync(path.join(packageDir, 'package.json'))) {
      problems.push(`production dependency "${entry.name}" is not installed`);
    }
    const licenseName = licenseFileIn(packageDir);
    const text = licenseName ? readFileSync(path.join(packageDir, licenseName), 'utf8') : '';
    if (!text.trim()) {
      problems.push(`production dependency "${entry.name}" has no license notice`);
    }
    return { ...entry, text };
  });
  return { entries, problems };
}

function validateWorkingTree(pkg, lock) {
  const problems = validateManifestAndLock(pkg, lock);
  for (const file of [...GENERATED_ENTRY_POINTS, ...REQUIRED_SCHEMAS, NOTICES_PATH]) {
    if (!existsSync(path.join(extensionRoot, file))) {
      problems.push(`runtime artifact "${file}" is missing`);
    }
  }
  const closure = serverDependencyClosure(pkg, lock);
  for (const root of serverExternalRoots(pkg)) {
    if (!closure.includes(`node_modules/${root}`)) {
      problems.push(`server external dependency "${root}" is missing from the lockfile`);
    }
  }
  for (const packagePath of closure) {
    if (!existsSync(path.join(extensionRoot, packagePath, 'package.json'))) {
      problems.push(`runtime dependency "${packagePath}" is not installed`);
    }
  }
  const { entries, problems: dependencyProblems } = shippedClosureWithText(lock);
  problems.push(...dependencyProblems);
  if (existsSync(path.join(extensionRoot, NOTICES_PATH))) {
    const actual = readFileSync(path.join(extensionRoot, NOTICES_PATH), 'utf8');
    if (actual !== renderNotices(entries)) {
      problems.push(`${NOTICES_PATH} is stale; rerun "npm run generate:notices"`);
    }
  }
  for (const file of GENERATED_ENTRY_POINTS) {
    const bundlePath = path.join(extensionRoot, file);
    if (existsSync(bundlePath)) {
      problems.push(...bundledRequireProblems(readFileSync(bundlePath, 'utf8'), pkg, lock));
    }
  }
  for (const packagePath of productionPackagePaths(lock)) {
    const absolute = path.join(extensionRoot, packagePath);
    if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
      problems.push(`installed production package "${packagePath}" is a symlink`);
    }
  }
  return problems.sort();
}

function validateVsix(vsixPath, pkg, lock) {
  let entries;
  try {
    entries = execFileSync('unzip', ['-Z1', vsixPath], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch (error) {
    return [`cannot inspect VSIX "${vsixPath}": ${error.message}`];
  }

  const problems = validateArchiveEntries(entries, pkg, lock);

  const { entries: noticeEntries, problems: noticeProblems } = shippedClosureWithText(lock);
  problems.push(...noticeProblems);
  try {
    const archivedNotices = execFileSync('unzip', ['-p', vsixPath, `extension/${NOTICES_PATH}`], { encoding: 'utf8' });
    if (archivedNotices !== renderNotices(noticeEntries)) {
      problems.push(`VSIX ${NOTICES_PATH} is stale relative to the lockfile; rerun "npm run generate:notices"`);
    }
  } catch (error) {
    problems.push(`cannot read ${NOTICES_PATH} from VSIX: ${error.message}`);
  }
  for (const file of GENERATED_ENTRY_POINTS) {
    try {
      const bundleText = execFileSync('unzip', ['-p', vsixPath, `extension/${file}`], { encoding: 'utf8' });
      problems.push(...bundledRequireProblems(bundleText, pkg, lock));
    } catch (error) {
      problems.push(`cannot read ${file} from VSIX: ${error.message}`);
    }
  }

  try {
    const archivedPkg = JSON.parse(
      execFileSync('unzip', ['-p', vsixPath, 'extension/package.json'], { encoding: 'utf8' })
    );
    problems.push(...validateManifestAndLock(archivedPkg, { packages: {} }));
    if (archivedPkg.version !== pkg.version) {
      problems.push(`VSIX version ${archivedPkg.version} does not match package version ${pkg.version}`);
    }
    if (archivedPkg.main !== './client/extension.cjs') {
      problems.push(`VSIX main entry point is ${archivedPkg.main}, expected ./client/extension.cjs`);
    }
  } catch (error) {
    problems.push(`cannot read extension/package.json from VSIX: ${error.message}`);
  }
  return problems.sort();
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(extensionRoot, 'package-lock.json'), 'utf8'));
  const requestedVsix = process.argv[2];
  const problems = requestedVsix
    ? validateVsix(path.resolve(extensionRoot, requestedVsix), pkg, lock)
    : validateWorkingTree(pkg, lock);

  if (problems.length) {
    console.error('VS Code package validation failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`validate-package: OK${requestedVsix ? ` (${requestedVsix})` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

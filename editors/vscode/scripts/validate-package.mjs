#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_SPEC = /^(?:file|link|workspace):|^(?:\.{1,2}[\\/]|~[\\/]|[\\/])|^[A-Za-z]:[\\/]/i;
const REQUIRED_FILES = [
  'extension.js',
  'server/server.js',
  'node_modules/@designlasagna/schemas/v0.3/tokens.json',
  'node_modules/@designlasagna/schemas/v0.4/tokens.json',
  'node_modules/@designlasagna/schemas/v0.4/lifecycle.json',
  'node_modules/@designlasagna/schemas/dtcg/2025.10/format.json',
];

function runtimeDependencyNames(pkg) {
  return Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  });
}

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

export function requiredArchivePaths(pkg, lock) {
  const paths = new Set(REQUIRED_FILES.map(file => `extension/${file}`));
  for (const name of runtimeDependencyNames(pkg)) {
    paths.add(`extension/node_modules/${name}/package.json`);
  }
  for (const packagePath of productionPackagePaths(lock)) {
    paths.add(`extension/${packagePath}/package.json`);
  }
  return [...paths].sort();
}

export function validateArchiveEntries(entries, pkg, lock) {
  const present = new Set(entries);
  return requiredArchivePaths(pkg, lock)
    .filter(file => !present.has(file))
    .map(file => `VSIX is missing runtime artifact "${file}"`);
}

function validateWorkingTree(pkg, lock) {
  const problems = validateManifestAndLock(pkg, lock);
  for (const file of REQUIRED_FILES) {
    const absolute = path.join(extensionRoot, file);
    if (!existsSync(absolute)) problems.push(`runtime artifact "${file}" is missing`);
  }
  for (const name of runtimeDependencyNames(pkg)) {
    const packageJson = path.join(extensionRoot, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(packageJson)) problems.push(`runtime dependency "${name}" is not installed`);
  }
  for (const packagePath of productionPackagePaths(lock)) {
    const absolute = path.join(extensionRoot, packagePath);
    if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
      problems.push(`installed production package "${packagePath}" is a symlink`);
    }
  }
  return problems;
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
  try {
    const archivedPkg = JSON.parse(
      execFileSync('unzip', ['-p', vsixPath, 'extension/package.json'], { encoding: 'utf8' })
    );
    problems.push(...validateManifestAndLock(archivedPkg, { packages: {} }));
    if (archivedPkg.version !== pkg.version) {
      problems.push(`VSIX version ${archivedPkg.version} does not match package version ${pkg.version}`);
    }
  } catch (error) {
    problems.push(`cannot read extension/package.json from VSIX: ${error.message}`);
  }
  return problems;
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

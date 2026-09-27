import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bundledDependencyNames,
  bundledRequireProblems,
  renderNotices,
  requiredArchivePaths,
  shippedClosureEntries,
  serverDependencyClosure,
  validateArchiveEntries,
  validateManifestAndLock,
} from './validate-package.mjs';

const pkg = {
  dependencies: {
    '@designlasagna/schemas': '^0.4.0',
    ajv: '^8.20.0',
    'ajv-formats': '^3.0.1',
    'jsonc-parser': '^3.3.1',
    'vscode-languageclient': '^9.0.1',
  },
  scripts: {
    'bundle-server':
      'esbuild server.ts --bundle --format=cjs --external:@designlasagna/schemas',
  },
};
const lock = {
  packages: {
    '': { dependencies: pkg.dependencies },
    'node_modules/@designlasagna/schemas': { version: '0.4.0', license: 'MIT' },
    'node_modules/ajv': {
      version: '8.20.0',
      license: 'MIT',
      dependencies: { 'fast-deep-equal': '^3.1.3' },
    },
    'node_modules/ajv-formats': { version: '3.0.1', license: 'MIT', dependencies: { ajv: '^8.0.0' } },
    'node_modules/fast-deep-equal': { version: '3.1.3', license: 'MIT' },
    'node_modules/jsonc-parser': { version: '3.3.1', license: 'MIT' },
    'node_modules/vscode-languageclient': {
      version: '9.0.1',
      license: 'MIT',
      dependencies: { 'vscode-languageserver-protocol': '3.17.5' },
    },
    'node_modules/vscode-languageclient/node_modules/minimatch': {
      version: '5.1.9',
      license: 'ISC',
    },
    'node_modules/vscode-languageserver-protocol': {
      version: '3.17.5',
      license: 'MIT',
      dependencies: { 'vscode-jsonrpc': '8.2.0' },
    },
    'node_modules/vscode-jsonrpc': { version: '8.2.0', license: 'MIT' },
    'node_modules/dev-only': { version: '1.0.0', dev: true, license: 'MIT' },
  },
};

function archiveWithLicenses(paths) {
  return [
    ...paths,
    'extension/node_modules/@designlasagna/schemas/LICENSE',
  ];
}

test('accepts registry dependencies and derives the shipped closures', () => {
  assert.deepEqual(validateManifestAndLock(pkg, lock), []);
  // Only the published schema package ships from node_modules.
  assert.deepEqual(serverDependencyClosure(pkg, lock), [
    'node_modules/@designlasagna/schemas',
  ]);
  // Everything else is compiled into the generated entry points.
  assert.deepEqual(bundledDependencyNames(pkg, lock), [
    'ajv',
    'ajv-formats',
    'fast-deep-equal',
    'jsonc-parser',
    'minimatch',
    'vscode-jsonrpc',
    'vscode-languageclient',
    'vscode-languageserver-protocol',
  ]);
  const required = requiredArchivePaths(pkg, lock);
  assert(required.includes('extension/client/extension.cjs'));
  assert(required.includes('extension/server/server.js'));
  assert(required.includes('extension/licenses/THIRD-PARTY-NOTICES.md'));
  assert(required.includes('extension/node_modules/@designlasagna/schemas/package.json'));
  assert(required.includes('extension/node_modules/@designlasagna/schemas/v0.4/tokens.json'));
  assert(!required.includes('extension/node_modules/ajv/package.json'));
  assert(!required.includes('extension/node_modules/vscode-languageclient/package.json'));
  assert(!required.includes('extension/node_modules/dev-only/package.json'));
  assert(!required.includes('extension/extension.js'));
});

test('rejects local manifest dependencies and linked lockfile packages', () => {
  const problems = validateManifestAndLock(
    { dependencies: { schemas: 'file:../../../schemas', other: '../other' } },
    {
      packages: {
        'node_modules/schemas': { resolved: '../../../schemas', link: true },
      },
    }
  );
  assert.equal(problems.length, 4);
  assert(problems.some(problem => problem.includes('schemas') && problem.includes('local reference')));
  assert(problems.some(problem => problem.includes('is a symlink')));
  assert(problems.some(problem => problem.includes('resolves locally')));
});

test('reports a missing bundled client, server, or retained dependency in the VSIX', () => {
  const entries = archiveWithLicenses(requiredArchivePaths(pkg, lock).filter(
    file =>
      file !== 'extension/client/extension.cjs'
      && file !== 'extension/server/server.js'
      && file !== 'extension/node_modules/@designlasagna/schemas/package.json',
  ));
  assert.deepEqual(validateArchiveEntries(entries, pkg, lock), [
    'VSIX is missing runtime artifact "extension/client/extension.cjs"',
    'VSIX is missing runtime artifact "extension/node_modules/@designlasagna/schemas/package.json"',
    'VSIX is missing runtime artifact "extension/server/server.js"',
  ]);
});

test('reports a missing license notice for a retained dependency', () => {
  const entries = archiveWithLicenses(requiredArchivePaths(pkg, lock)).filter(
    file => file !== 'extension/node_modules/@designlasagna/schemas/LICENSE',
  );
  assert.deepEqual(validateArchiveEntries(entries, pkg, lock), [
    'VSIX is missing the license notice for "node_modules/@designlasagna/schemas"',
  ]);
});

test('rejects bundled client packages, TypeScript sources, and other unexpected files in the VSIX', () => {
  const entries = archiveWithLicenses(requiredArchivePaths(pkg, lock));
  entries.push(
    'extension/node_modules/vscode-languageclient/package.json',
    'extension/node_modules/vscode-languageclient/out/node.js',
    'extension/node_modules/@designlasagna/schemas/private/extra.json',
    'extension/extension.js',
    'extension/server/schema-validation.ts',
    'stray.txt',
  );
  assert.deepEqual(validateArchiveEntries(entries, pkg, lock), [
    'VSIX contains TypeScript source "extension/server/schema-validation.ts"',
    'VSIX contains unexpected artifact "extension/extension.js"',
    'VSIX contains unexpected artifact "extension/server/schema-validation.ts"',
    'VSIX contains unexpected artifact "stray.txt"',
    'VSIX contains unexpected runtime artifact "extension/node_modules/@designlasagna/schemas/private/extra.json"',
    'VSIX contains unexpected runtime artifact "extension/node_modules/vscode-languageclient/out/node.js"',
    'VSIX contains unexpected runtime artifact "extension/node_modules/vscode-languageclient/package.json"',
  ]);
});

test('detects a generated bundle that still requires a bundled dependency', () => {
  assert.deepEqual(
    bundledRequireProblems('module.exports=void 0;var a=require("ajv");', pkg, lock),
    ['bundle still requires bundled dependency "ajv" at runtime']
  );
  assert.deepEqual(
    bundledRequireProblems('var b=require(\'vscode-languageclient\');var c=require( "jsonc-parser" );', pkg, lock),
    [
      'bundle still requires bundled dependency "jsonc-parser" at runtime',
      'bundle still requires bundled dependency "vscode-languageclient" at runtime',
    ]
  );
  assert.deepEqual(bundledRequireProblems('var a=require("@designlasagna/schemas/v0.4/tokens.json");', pkg, lock), []);
});

test('derives the shipped closure for notices from the lockfile and renders it deterministically', () => {
  const entries = shippedClosureEntries(lock).map((entry) => ({ ...entry, text: `license text for ${entry.name}` }));
  assert.deepEqual(entries.map((entry) => entry.name), [
    '@designlasagna/schemas',
    'ajv',
    'ajv-formats',
    'fast-deep-equal',
    'jsonc-parser',
    'minimatch',
    'vscode-jsonrpc',
    'vscode-languageclient',
    'vscode-languageserver-protocol',
  ]);
  assert(entries.every((entry) => entry.version && entry.license));
  const rendered = renderNotices(entries);
  assert(rendered.startsWith('# Third-party notices'));
  assert(rendered.includes('## ajv 8.20.0 — MIT'));
  assert(rendered.includes('license text for ajv'));
  assert(!rendered.includes('dev-only'));

  // Colliding package names keep their lockfile path in the heading.
  const duplicated = shippedClosureEntries({
    packages: {
      'node_modules/dep': { version: '1.0.0', license: 'MIT' },
      'node_modules/other/node_modules/dep': { version: '2.0.0', license: 'MIT' },
    },
  }).map((entry) => ({ ...entry, text: 'text' }));
  const renderedDuplicate = renderNotices(duplicated);
  assert(renderedDuplicate.includes('## dep 1.0.0 — MIT (node_modules/dep)'));
  assert(renderedDuplicate.includes('## dep 2.0.0 — MIT (node_modules/other/node_modules/dep)'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requiredArchivePaths,
  validateArchiveEntries,
  validateManifestAndLock,
} from './validate-package.mjs';

const pkg = {
  dependencies: {
    '@designlasagna/schemas': '^0.4.0',
    ajv: '^8.20.0',
  },
};
const lock = {
  packages: {
    '': { dependencies: pkg.dependencies },
    'node_modules/@designlasagna/schemas': { version: '0.4.0' },
    'node_modules/ajv': { version: '8.20.0' },
    'node_modules/dev-only': { version: '1.0.0', dev: true },
  },
};

test('accepts registry dependencies and excludes development packages', () => {
  assert.deepEqual(validateManifestAndLock(pkg, lock), []);
  const required = requiredArchivePaths(pkg, lock);
  assert(required.includes('extension/node_modules/ajv/package.json'));
  assert(!required.includes('extension/node_modules/dev-only/package.json'));
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

test('reports a missing bundled server or production dependency in the VSIX', () => {
  const entries = requiredArchivePaths(pkg, lock).filter(
    file => file !== 'extension/server/server.js' && file !== 'extension/node_modules/ajv/package.json'
  );
  assert.deepEqual(validateArchiveEntries(entries, pkg, lock), [
    'VSIX is missing runtime artifact "extension/node_modules/ajv/package.json"',
    'VSIX is missing runtime artifact "extension/server/server.js"',
  ]);
});

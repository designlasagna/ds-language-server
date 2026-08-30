import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverManifests } from '../src/discovery.js';

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) fs.rmSync(workspace, { recursive: true, force: true });
});

function workspaceWithTokenDocument(name: string, document: unknown): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-'));
  workspaces.push(workspace);
  const packageDir = path.join(workspace, 'node_modules', '@acme', name);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'tokens.json'), JSON.stringify(document));
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: `@acme/${name}`,
    designSystem: { tokens: './tokens.json' },
  }));
  return workspace;
}

describe('discoverManifests token sources', () => {
  it.each([
    ['a Design Lasagna manifest', { schemaVersion: '0.3.0', tokens: [] }],
    ['authored DTCG source', { number: { $type: 'number', $value: 1 } }],
  ])('discovers %s declared by designSystem.tokens', (name, document) => {
    const workspace = workspaceWithTokenDocument('tokens', document);
    const sources = discoverManifests(workspace);

    expect(sources.tokens).toEqual([
      expect.objectContaining({ packageName: '@acme/tokens', path: expect.stringMatching(/tokens\.json$/) }),
    ]);
  });
});

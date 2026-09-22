import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discover, discoverManifests, loadConfig } from '../src/discovery.js';

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

describe('loadConfig', () => {
  function createWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-config-'));
    workspaces.push(workspace);
    return workspace;
  }

  it('uses JSON > JS > MJS precedence', async () => {
    const workspace = createWorkspace();
    fs.writeFileSync(path.join(workspace, 'ds.config.mjs'), 'export default { languages: ["mjs"] };');
    fs.writeFileSync(path.join(workspace, 'ds.config.js'), 'module.exports = { languages: ["js"] };');
    fs.writeFileSync(path.join(workspace, 'ds.config.json'), JSON.stringify({ languages: ['json'] }));

    expect((await loadConfig(workspace))?.languages).toEqual(['json']);
    fs.rmSync(path.join(workspace, 'ds.config.json'));
    expect((await loadConfig(workspace))?.languages).toEqual(['js']);
    fs.rmSync(path.join(workspace, 'ds.config.js'));
    expect((await loadConfig(workspace))?.languages).toEqual(['mjs']);
  });

  it.each([
    ['CommonJS', 'ds.config.js', (value: string) => `module.exports = { languages: ["${value}"] };`],
    ['ES module', 'ds.config.mjs', (value: string) => `export default { languages: ["${value}"] };`],
  ])('reloads fresh %s config values', async (_format, name, source) => {
    const workspace = createWorkspace();
    const configPath = path.join(workspace, name);
    fs.writeFileSync(configPath, source('first'));
    expect((await loadConfig(workspace))?.languages).toEqual(['first']);

    fs.writeFileSync(configPath, source('second'));
    expect((await loadConfig(workspace))?.languages).toEqual(['second']);
  });

  it('reloads fresh type:module .js config values', async () => {
    const workspace = createWorkspace();
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module' }));
    const configPath = path.join(workspace, 'ds.config.js');
    fs.writeFileSync(configPath, 'export default { languages: ["first"] };');
    expect((await loadConfig(workspace))?.languages).toEqual(['first']);

    fs.writeFileSync(configPath, 'export default { languages: ["second"] };');
    expect((await loadConfig(workspace))?.languages).toEqual(['second']);
  });

  it('loads a type:module .js config with top-level await', async () => {
    const workspace = createWorkspace();
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module' }));
    fs.writeFileSync(
      path.join(workspace, 'ds.config.js'),
      'const language = await Promise.resolve("async"); export default { languages: [language] };',
    );

    expect((await loadConfig(workspace))?.languages).toEqual(['async']);
  });

  it('returns no config for invalid or deleted configuration', async () => {
    const workspace = createWorkspace();
    const configPath = path.join(workspace, 'ds.config.json');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fs.writeFileSync(configPath, '{ invalid');
    expect(await loadConfig(workspace)).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to load ds.config.json'));

    error.mockClear();
    fs.rmSync(configPath);
    expect(await loadConfig(workspace)).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No configuration file found'));
    error.mockRestore();
  });
});

describe('manual fixture workspace', () => {
  it('uses only its local manifests with package discovery disabled', () => {
    const workspace = path.join(import.meta.dirname, 'test-project');
    const config = JSON.parse(fs.readFileSync(path.join(workspace, 'ds.config.json'), 'utf8'));

    expect(discoverManifests(workspace, config)).toEqual({
      components: [expect.objectContaining({ packageName: 'config', path: expect.stringMatching(/manifests\/custom-elements\.json$/) })],
      tokens: [expect.objectContaining({ packageName: 'config', path: expect.stringMatching(/manifests\/tokens\.json$/) })],
      utilities: [expect.objectContaining({ packageName: 'config', path: expect.stringMatching(/manifests\/utilities\.manifest\.json$/) })],
    });
  });
});

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

describe('discover watch targets', () => {
  function createWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-discovery-'));
    workspaces.push(workspace);
    return workspace;
  }

  function writePackage(workspace: string, name: string, metadata: Record<string, unknown>): string {
    const packageDir = path.join(workspace, 'node_modules', ...name.split('/'));
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, ...metadata }));
    return packageDir;
  }

  it('retains missing package-declared files and discovers them when recreated', () => {
    const workspace = createWorkspace();
    const packageDir = writePackage(workspace, '@acme/widgets', {
      customElements: './generated/elements.data',
      designSystem: {
        tokens: './generated/arbitrary.tokens',
        utilities: './generated/classes.manifest',
      },
    });
    const generatedDir = path.join(packageDir, 'generated');
    const componentPath = path.join(generatedDir, 'elements.data');
    const tokenPath = path.join(generatedDir, 'arbitrary.tokens');
    const utilityPath = path.join(generatedDir, 'classes.manifest');
    fs.mkdirSync(generatedDir);
    fs.writeFileSync(tokenPath, '{}');

    const initial = discover(workspace);
    expect(initial.sources).toEqual({
      components: [],
      tokens: [{ path: tokenPath, packageName: '@acme/widgets' }],
      utilities: [],
    });
    expect(initial.watchTargets.files).toEqual(expect.arrayContaining([
      path.join(packageDir, 'package.json'),
      componentPath,
      tokenPath,
      utilityPath,
    ]));
    expect(initial.watchTargets.directories).toEqual(expect.arrayContaining([
      path.join(workspace, 'node_modules'),
      path.join(workspace, 'node_modules', '@acme'),
    ]));

    fs.writeFileSync(componentPath, '{}');
    fs.rmSync(tokenPath);
    const changed = discover(workspace);
    expect(changed.sources.components).toEqual([{ path: componentPath, packageName: '@acme/widgets' }]);
    expect(changed.sources.tokens).toEqual([]);
    expect(changed.watchTargets.files).toEqual(expect.arrayContaining([componentPath, tokenPath]));
  });

  it('includes config, workspace metadata, and additive explicit targets outside the workspace', () => {
    const workspace = createWorkspace();
    const packageDir = writePackage(workspace, 'widgets', { customElements: './elements.json' });
    const discoveredPath = path.join(packageDir, 'elements.json');
    const explicitPath = path.join(workspace, 'local.tokens');
    const outsidePath = path.resolve(workspace, '..', `${path.basename(workspace)}-missing.json`);
    fs.writeFileSync(discoveredPath, '{}');
    fs.writeFileSync(explicitPath, '{}');

    const result = discover(workspace, {
      sources: { tokens: ['./local.tokens'], utilities: [outsidePath] },
    });

    expect(result.sources.components).toEqual([{ path: discoveredPath, packageName: 'widgets' }]);
    expect(result.sources.tokens).toEqual([{ path: explicitPath, packageName: 'config' }]);
    expect(result.watchTargets.files).toEqual(expect.arrayContaining([
      path.join(workspace, 'ds.config.json'),
      path.join(workspace, 'ds.config.js'),
      path.join(workspace, 'ds.config.mjs'),
      path.join(workspace, 'package.json'),
      explicitPath,
      outsidePath,
    ]));
  });

  it('respects discovery disabling and package allowlists', () => {
    const workspace = createWorkspace();
    const allowedDir = writePackage(workspace, '@acme/allowed', { customElements: './missing.cem' });
    const ignoredDir = writePackage(workspace, '@other/ignored', { customElements: './ignored.cem' });
    const topLevelDir = writePackage(workspace, 'top-level', { designSystem: { tokens: './missing.tokens' } });
    const explicitPath = path.join(workspace, 'missing-explicit.json');

    const allowed = discover(workspace, {
      discovery: { packages: ['@acme/allowed', 'top-level'] },
    });
    expect(allowed.watchTargets.files).toEqual(expect.arrayContaining([
      path.join(allowedDir, 'package.json'),
      path.join(allowedDir, 'missing.cem'),
      path.join(topLevelDir, 'package.json'),
      path.join(topLevelDir, 'missing.tokens'),
    ]));
    expect(allowed.watchTargets.files).not.toContain(path.join(ignoredDir, 'package.json'));
    expect(allowed.watchTargets.directories).toEqual([
      path.join(workspace, 'node_modules'),
      path.join(workspace, 'node_modules', '@acme'),
    ]);

    const disabled = discover(workspace, {
      discovery: { enabled: false },
      sources: { components: [explicitPath] },
    });
    expect(disabled.sources).toEqual({ components: [], tokens: [], utilities: [] });
    expect(disabled.watchTargets.directories).toEqual([]);
    expect(disabled.watchTargets.files).toEqual([
      path.join(workspace, 'ds.config.json'),
      path.join(workspace, 'ds.config.js'),
      path.join(workspace, 'ds.config.mjs'),
      path.join(workspace, 'package.json'),
      explicitPath,
    ]);
  });
});

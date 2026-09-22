import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { URI } from 'vscode-uri';

interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

class StdioLspClient {
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  readonly stderr: string[] = [];
  readonly serverRequests: RpcMessage[] = [];
  rejectWatchRegistration = false;
  holdWatchRegistration = false;

  constructor(readonly process: ChildProcessWithoutNullStreams) {
    process.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.readMessages();
    });
    process.stderr.on('data', (chunk: Buffer) => this.stderr.push(chunk.toString()));
    process.on('exit', (code, signal) => {
      const error = new Error(`Server exited (${code ?? signal}); stderr: ${this.stderr.join('')}`);
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
    });
  }

  request(method: string, params: unknown, timeoutMs = 5_000): Promise<unknown> {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}; stderr: ${this.stderr.join('')}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async waitForServerRequests(method: string, count: number, timeoutMs = 5_000): Promise<RpcMessage[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const matches = this.serverRequests.filter((message) => message.method === method);
      if (matches.length >= count) return matches;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${count} ${method} requests; stderr: ${this.stderr.join('')}`);
  }

  private send(message: unknown): void {
    const json = JSON.stringify(message);
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }

  private readMessages(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString();
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) throw new Error(`Invalid LSP header: ${header}`);
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;

      const message = JSON.parse(this.buffer.subarray(bodyStart, bodyStart + length).toString()) as RpcMessage;
      this.buffer = this.buffer.subarray(bodyStart + length);
      if (message.method && message.id !== undefined) {
        this.serverRequests.push(message);
        const watchRegistration = message.method === 'client/registerCapability'
          && JSON.stringify(message.params).includes('workspace/didChangeWatchedFiles');
        if (watchRegistration && this.holdWatchRegistration) {
          continue;
        } else if (watchRegistration && this.rejectWatchRegistration) {
          this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'rejected by test client' } });
        } else {
          this.send({ jsonrpc: '2.0', id: message.id, result: null });
        }
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
        }
      }
    }
  }
}

const tempDirs: string[] = [];
const servers: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.kill();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeManifest(file: string, tagName: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: '1.0.0',
    modules: [{
      kind: 'javascript-module',
      declarations: [{ kind: 'class', name: tagName, customElement: true, tagName }],
    }],
  }));
}

async function startServer(
  workspace: string,
  capabilities: Record<string, unknown> = {},
  rejectWatchRegistration = false,
): Promise<{ client: StdioLspClient; documentUri: string }> {
  const serverPath = path.join(import.meta.dirname, '..', 'src', 'server.ts');
  const server = spawn(process.execPath, ['--import', 'tsx', serverPath, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  servers.push(server);
  const client = new StdioLspClient(server);
  client.rejectWatchRegistration = rejectWatchRegistration;
  await client.request('initialize', {
    processId: process.pid,
    rootUri: URI.file(workspace).toString(),
    capabilities,
  });
  client.notify('initialized', {});

  const documentUri = URI.file(path.join(workspace, 'test.html')).toString();
  client.notify('textDocument/didOpen', {
    textDocument: { uri: documentUri, languageId: 'html', version: 1, text: '<' },
  });
  return { client, documentUri };
}

async function waitForFile(file: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for marker file ${file}`);
}

async function waitForExit(server: ChildProcessWithoutNullStreams, timeoutMs = 5_000): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for server exit')), timeoutMs);
    server.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForLabels(
  client: StdioLspClient,
  documentUri: string,
  predicate: (labels: string[]) => boolean,
): Promise<string[]> {
  const deadline = Date.now() + 5_000;
  let labels: string[] = [];
  while (Date.now() < deadline) {
    const result = await client.request('textDocument/completion', {
      textDocument: { uri: documentUri },
      position: { line: 0, character: 1 },
    }) as Array<{ label: string }> | { items: Array<{ label: string }> } | null;
    const items = Array.isArray(result) ? result : result?.items ?? [];
    labels = items.map((item) => item.label);
    if (predicate(labels)) return labels;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for completions; last labels: ${labels.join(', ')}`);
}

describe('stdio server configuration reloads', () => {
  it('loads at startup and refreshes config, source edits, and deletion', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-server-'));
    tempDirs.push(parent);
    const workspace = path.join(parent, 'workspace # encoded');
    fs.mkdirSync(workspace);
    const firstManifest = path.join(workspace, 'first.json');
    const secondManifest = path.join(workspace, 'second.json');
    writeManifest(firstManifest, 'first-element');
    writeManifest(secondManifest, 'second-element');
    const configPath = path.join(workspace, 'ds.config.js');
    fs.writeFileSync(configPath, 'module.exports = { discovery: { enabled: false }, sources: { components: ["first.json"] } };');

    const serverPath = path.join(import.meta.dirname, '..', 'src', 'server.ts');
    const server = spawn(process.execPath, ['--import', 'tsx', serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    servers.push(server);
    const client = new StdioLspClient(server);
    server.on('exit', (code) => {
      if (code && code !== 0) client.stderr.push(`server exited with ${code}`);
    });

    await client.request('initialize', {
      processId: process.pid,
      rootUri: URI.file(workspace).toString(),
      capabilities: {},
    });
    client.notify('initialized', {});

    const documentUri = URI.file(path.join(workspace, 'test.html')).toString();
    client.notify('textDocument/didOpen', {
      textDocument: { uri: documentUri, languageId: 'html', version: 1, text: '<' },
    });
    await waitForLabels(client, documentUri, (labels) => labels.includes('first-element'));

    fs.writeFileSync(configPath, 'module.exports = { discovery: { enabled: false }, sources: { components: ["second.json"] } };');
    client.notify('workspace/didChangeConfiguration', { settings: {} });
    await waitForLabels(client, documentUri, (labels) => labels.includes('second-element') && !labels.includes('first-element'));

    writeManifest(secondManifest, 'changed-element');
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: URI.file(secondManifest).toString(), type: 2 }],
    });
    await waitForLabels(client, documentUri, (labels) => labels.includes('changed-element') && !labels.includes('second-element'));

    // Start a slow MJS reload, then supersede it with a manifest-only event.
    // The fixture marker proves the first import passed the 100ms debounce and
    // actually began before the later event arrives.
    const mjsConfigPath = path.join(workspace, 'ds.config.mjs');
    const slowImportMarker = path.join(workspace, 'slow-import-started');
    fs.rmSync(configPath);
    fs.writeFileSync(mjsConfigPath, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(slowImportMarker)}, 'started'); await new Promise(resolve => setTimeout(resolve, 200)); export default { discovery: { enabled: false }, sources: { components: ["first.json"] } };`);
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: URI.file(mjsConfigPath).toString(), type: 1 }],
    });
    await waitForFile(slowImportMarker);
    fs.writeFileSync(mjsConfigPath, 'export default { discovery: { enabled: false }, sources: { components: ["second.json"] } };');
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: URI.file(secondManifest).toString(), type: 2 }],
    });
    await waitForLabels(client, documentUri, (labels) => labels.includes('changed-element'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await waitForLabels(client, documentUri, (labels) => labels.includes('changed-element') && !labels.includes('first-element'));

    fs.writeFileSync(mjsConfigPath, 'export default { invalid syntax');
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: URI.file(mjsConfigPath).toString(), type: 2 }],
    });
    await waitForLabels(client, documentUri, (labels) => labels.length === 0);

    fs.writeFileSync(mjsConfigPath, 'export default { discovery: { enabled: false }, sources: { components: ["second.json"] } };');
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: URI.file(mjsConfigPath).toString(), type: 2 }],
    });
    await waitForLabels(client, documentUri, (labels) => labels.includes('changed-element'));

    fs.rmSync(mjsConfigPath);
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: URI.file(mjsConfigPath).toString(), type: 3 }],
    });
    await waitForLabels(client, documentUri, (labels) => labels.length === 0);
  }, 15_000);

  it('reloads JavaScript config when the workspace package type changes', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-package-type-'));
    tempDirs.push(workspace);
    writeManifest(path.join(workspace, 'one.json'), 'package-type-one');
    writeManifest(path.join(workspace, 'two.json'), 'package-type-two');
    const packagePath = path.join(workspace, 'package.json');
    const configPath = path.join(workspace, 'ds.config.js');
    fs.writeFileSync(packagePath, JSON.stringify({ type: 'commonjs' }));
    fs.writeFileSync(configPath, 'module.exports = { discovery: { enabled: false }, sources: { components: ["one.json"] } };');

    const { client, documentUri } = await startServer(workspace);
    await waitForLabels(client, documentUri, (labels) => labels.includes('package-type-one'));

    fs.writeFileSync(configPath, 'export default { discovery: { enabled: false }, sources: { components: ["two.json"] } };');
    fs.writeFileSync(packagePath, JSON.stringify({ type: 'module' }));
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: URI.file(packagePath).toString(), type: 2 }],
    });
    await waitForLabels(client, documentUri, (labels) =>
      labels.includes('package-type-two') && !labels.includes('package-type-one'));
  }, 10_000);

  it('completes shutdown while watched-file registration is unresolved', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-pending-watch-'));
    tempDirs.push(workspace);
    fs.writeFileSync(path.join(workspace, 'ds.config.json'), JSON.stringify({ discovery: { enabled: false } }));

    const serverPath = path.join(import.meta.dirname, '..', 'src', 'server.ts');
    const server = spawn(process.execPath, ['--import', 'tsx', serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    servers.push(server);
    const client = new StdioLspClient(server);
    client.holdWatchRegistration = true;
    await client.request('initialize', {
      processId: process.pid,
      rootUri: URI.file(workspace).toString(),
      capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
    });
    client.notify('initialized', {});
    await client.waitForServerRequests('client/registerCapability', 1);

    await client.request('shutdown', null, 1_000);
    server.stdin.end();
    await waitForExit(server);
  }, 10_000);

  it('registers capability-aware watches, refreshes them, and unregisters on shutdown', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-dynamic-'));
    tempDirs.push(workspace);
    const first = path.join(workspace, 'first.json');
    const second = path.join(workspace, 'nested', 'second.json');
    writeManifest(first, 'dynamic-first');
    writeManifest(second, 'dynamic-second');
    const configPath = path.join(workspace, 'ds.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ discovery: { enabled: false }, sources: { components: ['first.json'] } }));

    const { client, documentUri } = await startServer(workspace, {
      workspace: {
        didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
        didChangeConfiguration: { dynamicRegistration: true },
      },
    });
    await waitForLabels(client, documentUri, (labels) => labels.includes('dynamic-first'));
    const registrations = await client.waitForServerRequests('client/registerCapability', 2);
    expect(registrations.some((request) => JSON.stringify(request.params).includes('workspace/didChangeConfiguration'))).toBe(true);
    expect(registrations.some((request) => JSON.stringify(request.params).includes('baseUri'))).toBe(true);

    fs.writeFileSync(configPath, JSON.stringify({ discovery: { enabled: false }, sources: { components: ['nested/second.json'] } }));
    client.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: URI.file(configPath).toString(), type: 2 }],
    });
    await waitForLabels(client, documentUri, (labels) => labels.includes('dynamic-second'));
    await client.waitForServerRequests('client/registerCapability', 3);
    await client.waitForServerRequests('client/unregisterCapability', 1);

    await client.request('shutdown', null);
    await client.waitForServerRequests('client/unregisterCapability', 3);
    client.notify('exit', null);
  }, 15_000);

  it('polls arbitrary explicit manifests through create, replace, delete, and recreate', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-poll-manifest-'));
    tempDirs.push(workspace);
    const manifest = path.join(workspace, 'components.any-name.data');
    fs.writeFileSync(path.join(workspace, 'ds.config.json'), JSON.stringify({
      discovery: { enabled: false },
      sources: { components: [path.basename(manifest)] },
    }));
    const { client, documentUri } = await startServer(workspace);
    await waitForLabels(client, documentUri, (labels) => labels.length === 0);

    writeManifest(manifest, 'created-element');
    await waitForLabels(client, documentUri, (labels) => labels.includes('created-element'));
    writeManifest(manifest, 'edited-element');
    await waitForLabels(client, documentUri, (labels) => labels.includes('edited-element'));
    const replacement = `${manifest}.replacement`;
    writeManifest(replacement, 'replaced-element');
    fs.renameSync(replacement, manifest);
    await waitForLabels(client, documentUri, (labels) => labels.includes('replaced-element'));
    fs.rmSync(manifest);
    await waitForLabels(client, documentUri, (labels) => labels.length === 0);
    writeManifest(manifest, 'recreated-element');
    await waitForLabels(client, documentUri, (labels) => labels.includes('recreated-element'));
    expect(client.serverRequests.filter((request) => request.method === 'client/registerCapability')).toHaveLength(0);
  }, 20_000);

  it('polls config creation, changes, and deletion', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-poll-config-'));
    tempDirs.push(workspace);
    writeManifest(path.join(workspace, 'one.json'), 'config-one');
    writeManifest(path.join(workspace, 'two.json'), 'config-two');
    const { client, documentUri } = await startServer(workspace);
    await waitForLabels(client, documentUri, (labels) => labels.length === 0);

    const configPath = path.join(workspace, 'ds.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ discovery: { enabled: false }, sources: { components: ['one.json'] } }));
    await waitForLabels(client, documentUri, (labels) => labels.includes('config-one'));
    fs.writeFileSync(configPath, JSON.stringify({ discovery: { enabled: false }, sources: { components: ['two.json'] } }));
    await waitForLabels(client, documentUri, (labels) => labels.includes('config-two') && !labels.includes('config-one'));
    fs.rmSync(configPath);
    await waitForLabels(client, documentUri, (labels) => labels.length === 0);
  }, 20_000);

  it('polls scoped package metadata changes and newly installed packages', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-poll-package-'));
    tempDirs.push(workspace);
    const { client, documentUri } = await startServer(workspace);
    await waitForLabels(client, documentUri, (labels) => labels.length === 0);

    const firstPackage = path.join(workspace, 'node_modules', '@scope', 'first');
    writeManifest(path.join(firstPackage, 'one.cem'), 'package-one');
    fs.writeFileSync(path.join(firstPackage, 'package.json'), JSON.stringify({ customElements: 'one.cem' }));
    await waitForLabels(client, documentUri, (labels) => labels.includes('package-one'));

    writeManifest(path.join(firstPackage, 'two.cem'), 'package-two');
    fs.writeFileSync(path.join(firstPackage, 'package.json'), JSON.stringify({ customElements: 'two.cem' }));
    await waitForLabels(client, documentUri, (labels) => labels.includes('package-two') && !labels.includes('package-one'));

    const secondPackage = path.join(workspace, 'node_modules', '@scope', 'second');
    writeManifest(path.join(secondPackage, 'elements.cem'), 'new-package');
    fs.writeFileSync(path.join(secondPackage, 'package.json'), JSON.stringify({ customElements: 'elements.cem' }));
    await waitForLabels(client, documentUri, (labels) => labels.includes('new-package'));
  }, 20_000);

  it('falls back to polling when watched-file registration is rejected', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ls-rejected-watch-'));
    tempDirs.push(workspace);
    const manifest = path.join(workspace, 'eventual.cem');
    fs.writeFileSync(path.join(workspace, 'ds.config.json'), JSON.stringify({
      discovery: { enabled: false },
      sources: { components: ['eventual.cem'] },
    }));
    const { client, documentUri } = await startServer(workspace, {
      workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
    }, true);
    await client.waitForServerRequests('client/registerCapability', 1);
    writeManifest(manifest, 'fallback-element');
    await waitForLabels(client, documentUri, (labels) => labels.includes('fallback-element'));
    expect(client.serverRequests.some((request) =>
      request.method === 'client/registerCapability'
      && JSON.stringify(request.params).includes('workspace/didChangeWatchedFiles'))).toBe(true);
  }, 15_000);
});

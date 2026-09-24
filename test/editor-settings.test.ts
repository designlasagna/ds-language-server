import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { URI } from 'vscode-uri';

const projectRoot = path.join(import.meta.dirname, '..');

async function waitFor(timeoutMs: number, pollMs: number, predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for RPC condition'));
        return;
      }
      setTimeout(check, pollMs);
    };
    check();
  });
}

interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface DeprecationDiagnostic {
  severity: number;
  data?: { type?: string };
}

type RequestResolver = (message: RpcMessage) => void;

/**
 * Minimal LSP client over stdio with Content-Length framing. Unlike the
 * harness in server-config.test.ts, it captures server-to-client
 * notifications and lets the test queue responses for
 * workspace/configuration requests (or reject them).
 */
class EditorSettingsLspClient {
  readonly child: ChildProcessWithoutNullStreams;
  readonly serverRequests: RpcMessage[] = [];
  readonly serverNotifications: RpcMessage[] = [];
  configurationRequestCount = 0;
  holdConfigurationRequests = false;

  respondConfiguration(id: number, settings: unknown): void {
    this.send({ jsonrpc: '2.0', id, result: [settings] });
  }
  /** Queue of response results for workspace/configuration (one per request). */
  configurationResults: unknown[][] = [];
  /** Number of upcoming workspace/configuration requests to reject. */
  configurationRejections = 0;

  private pendingRequests = new Map<number, RequestResolver>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private stderrChunks: string[] = [];

  constructor(command: string, args: string[]) {
    // Inherit the repo cwd so the `tsx` import resolves; the workspace is
    // communicated through the initialize rootUri, not the process cwd.
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.readMessages();
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString());
    });
  }

  stderrText(): string {
    return this.stderrChunks.join('');
  }

  private send(message: unknown): void {
    const json = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }

  request(method: string, params: unknown, timeoutMs = 10_000): Promise<unknown> {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for ${method}; stderr: ${this.stderrText()}`));
      }, timeoutMs);
      this.pendingRequests.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
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
        if (message.method === 'workspace/configuration') {
          this.configurationRequestCount += 1;
          if (this.holdConfigurationRequests) continue;
          if (this.configurationRejections > 0) {
            this.configurationRejections -= 1;
            this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
            continue;
          }
          this.send({ jsonrpc: '2.0', id: message.id, result: this.configurationResults.shift() ?? [null] });
          continue;
        }
        // Capability registrations (didChangeConfiguration, etc.)
        this.send({ jsonrpc: '2.0', id: message.id, result: null });
        continue;
      }

      if (message.id !== undefined) {
        const resolver = this.pendingRequests.get(message.id);
        if (resolver) {
          this.pendingRequests.delete(message.id);
          resolver(message);
        }
        continue;
      }

      if (message.method) {
        this.serverNotifications.push(message);
      }
    }
  }

  async initialize(workspace: string, capabilities: unknown, initializationOptions?: unknown): Promise<unknown> {
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri: URI.file(workspace).toString(),
      capabilities,
      ...(initializationOptions !== undefined ? { initializationOptions } : {}),
    });
    this.notify('initialized', {});
    return result;
  }

  async didOpen(uri: string, text: string): Promise<void> {
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'html', version: 1, text } });
  }

  didChangeConfiguration(settings: unknown): void {
    this.notify('workspace/didChangeConfiguration', { settings });
  }

  async shutdownAndExit(): Promise<void> {
    await this.request('shutdown', undefined);
    this.notify('exit', {});
  }

  async waitForServerRequests(method: string, count: number, timeoutMs = 10_000): Promise<RpcMessage[]> {
    await waitFor(timeoutMs, 20, () => this.serverRequests.filter((m) => m.method === method).length >= count);
    return this.serverRequests.filter((m) => m.method === method);
  }

  private diagnosticsNotificationsFor(uri: string): DeprecationDiagnostic[][] {
    const result: DeprecationDiagnostic[][] = [];
    for (const message of this.serverNotifications) {
      if (message.method !== 'textDocument/publishDiagnostics') continue;
      const params = message.params as { uri: string; diagnostics: DeprecationDiagnostic[] };
      if (params.uri === uri) result.push(params.diagnostics);
    }
    return result;
  }

  /**
   * Wait until at least `minCount` publishDiagnostics notifications for the
   * document have arrived and the latest one satisfies the predicate. The
   * count requirement prevents a stale notification from satisfying the
   * predicate after a reload that must re-emit diagnostics.
   */
  async waitForDiagnostics(
    uri: string,
    timeoutMs: number,
    predicate: (diagnostics: DeprecationDiagnostic[]) => boolean,
    minCount = 1,
  ): Promise<void> {
    await waitFor(timeoutMs, 20, () => {
      const all = this.diagnosticsNotificationsFor(uri);
      if (all.length < minCount) return false;
      return predicate(all[all.length - 1]!);
    });
  }

  async waitForExit(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (this.child.exitCode !== null) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Server did not exit in time (exitCode=${this.child.exitCode})`));
          return;
        }
        setTimeout(check, 25);
      };
      check();
    });
  }
}

function startServer(workspace: string): EditorSettingsLspClient {
  const serverPath = path.join(projectRoot, 'src', 'server.ts');
  return new EditorSettingsLspClient(
    process.execPath,
    ['--import', 'tsx', serverPath, '--stdio'],
  );
}

let client: EditorSettingsLspClient | undefined;
let workspaceDir: string | undefined;

afterEach(async () => {
  if (client) {
    try {
      await client.shutdownAndExit();
    } catch {
      client.child.kill();
    }
    await client.waitForExit(5_000).catch(() => {});
    client = undefined;
  }
  if (workspaceDir) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    workspaceDir = undefined;
  }
});

function createWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-editor-settings-'));
  // A deprecated component with no valid removal date: default severity is
  // warning, overridable through diagnostics.deprecated.
  fs.writeFileSync(path.join(dir, 'old.cem'), JSON.stringify({
    schemaVersion: '1.0.0',
    modules: [{
      kind: 'javascript-module',
      declarations: [{
        kind: 'class',
        name: 'OldButton',
        tagName: 'old-button',
        customElement: true,
        deprecated: { message: 'Use the current button component.', removal: 'v2.0.0' },
      }],
    }],
  }));
  return dir;
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, 'ds.config.json'), JSON.stringify(config));
}

function documentUri(dir: string): string {
  return URI.file(path.join(dir, 'test.html')).toString();
}

const DOC = '<old-button>Save</old-button>';

// LSP DiagnosticSeverity is 1-based (Error = 1, Warning = 2, Information = 3, Hint = 4).
const SEVERITY_ERROR = 1;
const SEVERITY_WARNING = 2;
const SEVERITY_INFORMATION = 3;

function hasDiagnostic(diagnostics: DeprecationDiagnostic[], severity: number): boolean {
  return diagnostics.some((d) => d.severity === severity && d.data?.type === 'deprecated-component');
}

describe('editor settings', () => {
  it('ignores an older configuration response arriving after a newer one', async () => {
    workspaceDir = createWorkspace();
    writeConfig(workspaceDir, { discovery: { enabled: false }, sources: { components: ['old.cem'] } });
    client = startServer(workspaceDir);
    await client.initialize(workspaceDir, { workspace: { configuration: true } });
    await client.didOpen(documentUri(workspaceDir), DOC);
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, d => hasDiagnostic(d, SEVERITY_WARNING));
    client.holdConfigurationRequests = true;
    client.didChangeConfiguration({});
    const first = (await client.waitForServerRequests('workspace/configuration', 2))[1];
    client.didChangeConfiguration({});
    const second = (await client.waitForServerRequests('workspace/configuration', 3))[2];
    client.respondConfiguration(second.id!, { diagnostics: { deprecated: 'information' } });
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, d => hasDiagnostic(d, SEVERITY_INFORMATION), 2);
    client.respondConfiguration(first.id!, { diagnostics: { deprecated: 'error' } });
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, d => hasDiagnostic(d, SEVERITY_INFORMATION), 3);
  }, 60_000);

  it('shuts down without waiting for an unanswered configuration fetch', async () => {
    workspaceDir = createWorkspace();
    client = startServer(workspaceDir);
    client.holdConfigurationRequests = true;
    await client.initialize(workspaceDir, { workspace: { configuration: true } });
    await client.waitForServerRequests('workspace/configuration', 1);
    await client.shutdownAndExit();
    await client.waitForExit(5_000);
    client = undefined;
  }, 20_000);

  it('fetches the configuration section at initialize and change for supporting clients, merging editor settings above file settings', async () => {
    workspaceDir = createWorkspace();
    client = startServer(workspaceDir);

    // File settings suppress deprecation diagnostics; the fetched editor
    // settings must override them.
    writeConfig(workspaceDir, {
      discovery: { enabled: false },
      sources: { components: ['old.cem'] },
      diagnostics: { deprecated: 'off' },
    });

    client.configurationResults.push([{ diagnostics: { deprecated: 'error' } }]);
    await client.initialize(workspaceDir, { workspace: { configuration: true } });

    // Initialize-time fetch for the contributed section.
    const [fetch] = await client.waitForServerRequests('workspace/configuration', 1);
    expect((fetch.params as { items: Array<{ section: string }> }).items[0].section).toBe('dsLanguageServer');

    await client.didOpen(documentUri(workspaceDir), DOC);
    // Editor 'error' overrides file 'off'.
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_ERROR));

    // Change: the server refetches, and the fetched value replaces the
    // snapshot (the notification payload is not used for supporting clients).
    client.configurationResults.push([{ diagnostics: { deprecated: 'warning' } }]);
    client.didChangeConfiguration({ dsLanguageServer: { diagnostics: { deprecated: 'information' } } });
    await client.waitForServerRequests('workspace/configuration', 2);
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_WARNING), 2);

    // `{}` resets: the null fetch leaves file-only settings ('off').
    client.didChangeConfiguration({});
    await client.waitForServerRequests('workspace/configuration', 3);
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => diagnostics.length === 0, 3);
  }, 60_000);

  it('normalizes section-wrapped workspace/configuration responses from supporting clients', async () => {
    workspaceDir = createWorkspace();

    // File settings suppress deprecation diagnostics; a fetched editor
    // setting must override them to prove the fetch was applied.
    writeConfig(workspaceDir, {
      discovery: { enabled: false },
      sources: { components: ['old.cem'] },
      diagnostics: { deprecated: 'off' },
    });

    client = startServer(workspaceDir);

    // Zed-style response: the requested section arrives wrapped as
    // `{ dsLanguageServer: {...} }`.
    client.configurationResults.push([{ dsLanguageServer: { diagnostics: { deprecated: 'error' } } }]);
    await client.initialize(workspaceDir, { workspace: { configuration: true } });
    const [fetch] = await client.waitForServerRequests('workspace/configuration', 1);
    expect((fetch.params as { items: Array<{ section: string }> }).items[0].section).toBe('dsLanguageServer');

    await client.didOpen(documentUri(workspaceDir), DOC);
    // The wrapped initialize-time fetch result overrides the file 'off'.
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_ERROR));

    // A later wrapped workspace/configuration update must also be
    // normalized and replace the snapshot.
    client.configurationResults.push([{ dsLanguageServer: { diagnostics: { deprecated: 'information' } } }]);
    client.didChangeConfiguration({});
    await client.waitForServerRequests('workspace/configuration', 2);
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_INFORMATION), 2);
  }, 60_000);

  it('uses notification settings directly (wrapper or direct) without fetching for unsupported clients', async () => {
    workspaceDir = createWorkspace();
    client = startServer(workspaceDir);

    writeConfig(workspaceDir, {
      discovery: { enabled: false },
      sources: { components: ['old.cem'] },
    });

    // Notification registration does not imply workspace/configuration support.
    await client.initialize(workspaceDir, { workspace: { didChangeConfiguration: { dynamicRegistration: true } } });
    await client.didOpen(documentUri(workspaceDir), DOC);
    // Default severity for a deprecated component without a valid removal date.
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_WARNING));

    // Direct settings payload.
    client.didChangeConfiguration({ diagnostics: { deprecated: 'error' } });
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_ERROR), 2);

    // File-watcher-triggered reloads must preserve the current editor
    // settings: the fresh validation after the config rewrite still reports
    // error, not the default warning.
    writeConfig(workspaceDir, {
      discovery: { enabled: false },
      sources: { components: ['old.cem'] },
      discoveryOrder: ['components'],
    });
    await client.waitForDiagnostics(documentUri(workspaceDir), 15_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_ERROR), 3);

    // Section-wrapped payload.
    client.didChangeConfiguration({ dsLanguageServer: { diagnostics: { deprecated: 'off' } } });
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => diagnostics.length === 0, 4);

    // No workspace/configuration requests were ever sent.
    expect(client.configurationRequestCount).toBe(0);
  }, 60_000);

  it('seeds the snapshot from initializationOptions and resets it with {} for unsupported clients', async () => {
    workspaceDir = createWorkspace();
    client = startServer(workspaceDir);

    writeConfig(workspaceDir, {
      discovery: { enabled: false },
      sources: { components: ['old.cem'] },
    });

    await client.initialize(workspaceDir, {}, { dsLanguageServer: { diagnostics: { deprecated: 'information' } } });
    await client.didOpen(documentUri(workspaceDir), DOC);
    // initializationOptions seed the snapshot: information severity.
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_INFORMATION));

    // `{}` replaces (not merges) the snapshot: back to the default warning.
    client.didChangeConfiguration({});
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_WARNING), 2);

    expect(client.configurationRequestCount).toBe(0);
  }, 60_000);

  it('retains the prior snapshot when a configuration fetch is rejected', async () => {
    workspaceDir = createWorkspace();
    client = startServer(workspaceDir);

    writeConfig(workspaceDir, {
      discovery: { enabled: false },
      sources: { components: ['old.cem'] },
    });

    // The initialize-time fetch is rejected; the initializationOptions
    // snapshot must survive.
    client.configurationRejections = 1;
    await client.initialize(
      workspaceDir,
      { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } },
      { diagnostics: { deprecated: 'error' } },
    );

    await client.waitForServerRequests('workspace/configuration', 1);
    await client.didOpen(documentUri(workspaceDir), DOC);
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_ERROR));

    // A later successful fetch replaces the retained snapshot.
    client.configurationResults.push([{ diagnostics: { deprecated: 'warning' } }]);
    client.didChangeConfiguration({});
    await client.waitForServerRequests('workspace/configuration', 2);
    await client.waitForDiagnostics(documentUri(workspaceDir), 10_000, (diagnostics) => hasDiagnostic(diagnostics, SEVERITY_WARNING), 2);
  }, 60_000);
});

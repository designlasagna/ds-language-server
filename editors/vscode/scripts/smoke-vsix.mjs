#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionSourceRoot = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(extensionSourceRoot, '..', '..');
const archiveArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const archive = path.resolve(archiveArgument ?? path.join(extensionSourceRoot, 'design-system-language-server.vsix'));
const codeBinary = process.env.CODE_BINARY ?? '/usr/bin/code';
// The CLI launcher is used for installation; extension-host tests need the
// Electron executable so their process remains attached until tests finish.
const codeHostBinary = process.env.CODE_HOST_BINARY
  ?? (existsSync('/usr/share/code/code') ? '/usr/share/code/code' : codeBinary);
const skipVscode = process.argv.includes('--skip-vscode') || process.env.SKIP_VSCODE_SMOKE === '1';
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'dsls-vsix-smoke-'));
const extractedRoot = path.join(tempRoot, 'extracted');
const workspace = path.join(tempRoot, 'workspace');
const userDataDir = path.join(tempRoot, 'user-data');
const extensionsDir = path.join(tempRoot, 'extensions');
let server;
let code;
let archiveVersion;

function log(message) {
  process.stdout.write(`[vsix-smoke] ${message}\n`);
}

function run(command, args, options = {}) {
  log(`$ ${[command, ...args].map((part) => JSON.stringify(part)).join(' ')}`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000,
    env: options.env ?? process.env,
  });
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `${command} was terminated by ${result.signal}`);
  assert.equal(result.status, 0, `${command} exited with status ${result.status}`);
  return result;
}

function writeFixture() {
  mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
  writeFileSync(path.join(workspace, 'ds.config.json'), JSON.stringify({
    discovery: { enabled: false },
    sources: { components: ['old.cem.json'], tokens: ['tokens.json'] },
    diagnostics: { deprecated: 'off' },
    lifecycle: { profile: '0.4' },
  }, null, 2));
  writeFileSync(path.join(workspace, 'old.cem.json'), JSON.stringify({
    schemaVersion: '1.0.0',
    modules: [{
      kind: 'javascript-module',
      declarations: [{
        kind: 'class',
        name: 'OldButton',
        tagName: 'old-button',
        customElement: true,
        deprecated: { message: 'Use current-button.', removal: 'v2.0.0' },
      }],
    }],
  }, null, 2));
  writeFileSync(path.join(workspace, 'tokens.json'), JSON.stringify({
    schemaVersion: '0.4.0',
    tokens: [{ id: 'color.bad', resolved: { base: false } }],
  }, null, 2));
  writeFileSync(path.join(workspace, 'test.html'), '<old-button></old-button>\n<');
  writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
    'dsLanguageServer.diagnostics': { deprecated: 'information' },
  }, null, 2));
}

class LspClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.notifications = [];
    this.stderr = '';
    child.stdout.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.readMessages();
    });
    child.stderr.on('data', (chunk) => { this.stderr += chunk.toString(); });
    child.on('error', (cause) => {
      this.fail(new Error(`server failed to spawn: ${cause.message}`, { cause }));
    });
    child.on('exit', (exitCode, signal) => {
      this.fail(new Error(`server exited (${exitCode ?? signal}); stderr:\n${this.stderr}`));
    });
  }

  fail(error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }

  send(message) {
    const json = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  request(method, params, timeoutMs = 10_000) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method}; stderr:\n${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  readMessages() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString();
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      assert(match, `invalid LSP header: ${header}`);
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const message = JSON.parse(this.buffer.subarray(bodyStart, bodyStart + length).toString());
      this.buffer = this.buffer.subarray(bodyStart + length);

      if (message.method && message.id !== undefined) {
        this.send({ jsonrpc: '2.0', id: message.id, result: null });
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
          else pending.resolve(message.result);
        }
      } else if (message.method) {
        this.notifications.push(message);
      }
    }
  }

  async waitForNotification(method, predicate, from = 0, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.failure) throw this.failure;
      for (let index = from; index < this.notifications.length; index++) {
        const message = this.notifications[index];
        if (message.method === method && predicate(message.params)) return { message, index };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timed out waiting for ${method}; stderr:\n${this.stderr}`);
  }
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onExit = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for process exit'));
    }, timeoutMs);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function protocolSmoke(serverPath) {
  log(`starting isolated protocol server ${serverPath}`);
  server = spawn(process.execPath, [serverPath, '--stdio'], {
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_PATH: '' },
  });
  const client = new LspClient(server);
  const rootUri = pathToFileURL(`${workspace}${path.sep}`).href;
  const htmlUri = pathToFileURL(path.join(workspace, 'test.html')).href;
  const tokenUri = pathToFileURL(path.join(workspace, 'tokens.json')).href;
  const htmlText = readFileSync(path.join(workspace, 'test.html'), 'utf8');
  const tokenText = readFileSync(path.join(workspace, 'tokens.json'), 'utf8');

  const initialized = await client.request('initialize', {
    processId: process.pid,
    rootUri,
    capabilities: {},
    initializationOptions: { dsLanguageServer: { diagnostics: { deprecated: 'information' } } },
  });
  assert.equal(initialized.capabilities.completionProvider.resolveProvider, false);
  assert.equal(initialized.capabilities.hoverProvider, true);
  log('PASS protocol initialize advertises completion and hover');
  client.notify('initialized', {});
  client.notify('textDocument/didOpen', {
    textDocument: { uri: htmlUri, languageId: 'html', version: 1, text: htmlText },
  });
  client.notify('textDocument/didOpen', {
    textDocument: { uri: tokenUri, languageId: 'json', version: 1, text: tokenText },
  });

  let labels = [];
  const completionDeadline = Date.now() + 10_000;
  while (Date.now() < completionDeadline) {
    const result = await client.request('textDocument/completion', {
      textDocument: { uri: htmlUri },
      position: { line: 1, character: 1 },
    });
    const items = Array.isArray(result) ? result : result?.items ?? [];
    labels = items.map((item) => item.label);
    if (labels.includes('OldButton')) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(labels.includes('OldButton'), `completion labels did not include OldButton: ${labels.join(', ')}`);
  log('PASS protocol completion includes fixture component OldButton');

  const lifecycle = await client.waitForNotification('textDocument/publishDiagnostics', (params) =>
    params.uri === htmlUri && params.diagnostics.some((item) =>
      item.data?.type === 'deprecated-component' && item.severity === 3));
  log('PASS protocol lifecycle diagnostic honors initializationOptions (Information)');

  await client.waitForNotification('textDocument/publishDiagnostics', (params) =>
    params.uri === tokenUri && params.diagnostics.some((item) =>
      item.source === 'designlasagna-schema' && item.code === 'schema-manifest'));
  log('PASS protocol schema diagnostic proves packaged schemas/Ajv load');

  client.notify('workspace/didChangeConfiguration', {
    settings: { dsLanguageServer: { diagnostics: { deprecated: 'error' } } },
  });
  await client.waitForNotification('textDocument/publishDiagnostics', (params) =>
    params.uri === htmlUri && params.diagnostics.some((item) =>
      item.data?.type === 'deprecated-component' && item.severity === 1), lifecycle.index + 1);
  log('PASS protocol configuration reload changes lifecycle severity to Error');

  const shutdown = await client.request('shutdown', null);
  assert.equal(shutdown, null);
  client.notify('exit', null);
  await waitForExit(server);
  assert.equal(server.exitCode, 0, `server exit code; stderr:\n${client.stderr}`);
  server = undefined;
  log('PASS protocol shutdown/exit is clean');
}

function killProcessGroup(child) {
  if (!child?.pid) return;
  // The code launcher can exit after forking Electron. The detached process
  // group still belongs to this invocation and is safe to clean up.
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
}

async function vscodeSmoke() {
  if (skipVscode) {
    log('SKIP VS Code extension-host smoke (explicitly disabled)');
    return;
  }
  if (!existsSync(codeBinary)) throw new Error(`VS Code binary not found: ${codeBinary}`);
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(extensionsDir, { recursive: true });
  run(codeBinary, [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--install-extension', archive,
    '--force',
  ], { timeout: 60_000 });
  const listed = run(codeBinary, [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--list-extensions', '--show-versions',
  ]).stdout.toLowerCase();
  assert(listed.includes(`designlasagna.design-system-language-server@${archiveVersion}`), `candidate not listed:\n${listed}`);
  log('PASS VSIX installed only into disposable extensions directory');

  const tempRunner = path.join(tempRoot, 'vscode-smoke-runner.cjs');
  writeFileSync(tempRunner, readFileSync(path.join(scriptDir, 'vscode-smoke-runner.cjs')));
  // VS Code only launches extension tests in extension-development mode. This
  // disposable no-op driver has a different ID from the installed candidate;
  // the runner asserts the candidate itself came from extensionsDir.
  const testDriver = path.join(tempRoot, 'test-driver');
  mkdirSync(testDriver);
  writeFileSync(path.join(testDriver, 'package.json'), JSON.stringify({
    name: 'dsls-vsix-smoke-driver',
    displayName: 'DSLS VSIX smoke driver',
    version: '0.0.0',
    publisher: 'local-smoke',
    engines: { vscode: '^1.90.0' },
    main: './extension.cjs',
  }, null, 2));
  writeFileSync(path.join(testDriver, 'extension.cjs'), 'exports.activate = () => {}; exports.deactivate = () => {};\n');
  const args = [
    '--new-window',
    '--wait',
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${testDriver}`,
    `--extensionTestsPath=${tempRunner}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    workspace,
  ];
  log(`$ ${[codeHostBinary, ...args].map((part) => JSON.stringify(part)).join(' ')}`);
  code = spawn(codeHostBinary, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DSLS_SMOKE_EXTENSIONS_DIR: extensionsDir,
      DSLS_SMOKE_REPOSITORY_ROOT: repositoryRoot,
      DSLS_SMOKE_VERSION: archiveVersion,
    },
  });
  let stdout = '';
  let stderr = '';
  code.stdout.on('data', (chunk) => { stdout += chunk.toString(); process.stdout.write(chunk); });
  code.stderr.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
  let timeout;
  const result = await Promise.race([
    new Promise((resolve, reject) => {
      code.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
      code.once('error', (error) => reject(new Error(`VS Code failed to spawn: ${error.message}`, { cause: error })));
    }),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('VS Code extension-host smoke timed out after 60s')), 60_000);
    }),
  ]).finally(() => {
    clearTimeout(timeout);
    killProcessGroup(code);
  });
  assert.equal(result.signal, null, `VS Code terminated by ${result.signal}`);
  assert.equal(result.exitCode, 0, `VS Code exited ${result.exitCode}; stdout:\n${stdout}\nstderr:\n${stderr}`);
  assert(stdout.includes('[vscode-smoke] PASS all extension-host assertions'), `missing extension-host success marker; stdout:\n${stdout}`);
  code = undefined;
}

try {
  assert(existsSync(archive), `VSIX does not exist: ${archive}`);
  mkdirSync(extractedRoot);
  run('unzip', ['-q', archive, '-d', extractedRoot]);
  writeFixture();
  const extensionRoot = realpathSync(path.join(extractedRoot, 'extension'));
  assert(!extensionRoot.startsWith(`${realpathSync(repositoryRoot)}${path.sep}`));
  assert(!workspace.startsWith(`${realpathSync(repositoryRoot)}${path.sep}`));
  assert(!existsSync(path.join(tempRoot, 'node_modules')));
  const archivedPackage = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
  assert.equal(archivedPackage.name, 'design-system-language-server');
  assert.match(archivedPackage.version, /^\d+\.\d+\.\d+/);
  archiveVersion = archivedPackage.version;
  for (let current = path.dirname(extensionRoot); ; current = path.dirname(current)) {
    assert(!existsSync(path.join(current, 'node_modules')), `unexpected ancestor dependency directory: ${path.join(current, 'node_modules')}`);
    if (current === path.dirname(current)) break;
  }
  log(`PASS extracted archive and fixture are outside repository (${tempRoot}) with no ancestor node_modules`);
  await protocolSmoke(path.join(extensionRoot, 'server', 'server.js'));
  await vscodeSmoke();
  log('PASS all enabled isolated VSIX smoke checks');
} catch (error) {
  killProcessGroup(code);
  if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  console.error(`[vsix-smoke] FAIL ${error?.stack ?? error}`);
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

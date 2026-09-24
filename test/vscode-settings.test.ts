import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

function clientHarness() {
  let values: Record<string, any> = {};
  let options: any;
  let listener: (event: any) => void = () => {};
  const notifications: any[] = [];
  const workspace = {
    getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback, inspect: (name: string) => values[name] }),
    onDidChangeConfiguration: (callback: typeof listener) => { listener = callback; return { dispose() {} }; },
  };
  class LanguageClient {
    constructor(_id: string, _name: string, _server: unknown, clientOptions: unknown) { options = clientOptions; }
    start() { return Promise.resolve(); }
    stop() { return Promise.resolve(); }
    sendNotification(method: string, params: unknown) { notifications.push({ method, params }); return Promise.resolve(); }
  }
  const module = { exports: {} as any };
  runInNewContext(readFileSync(new URL('../editors/vscode/extension.js', import.meta.url), 'utf8'), {
    module, console,
    require: (name: string) => name === 'path' ? path : name === 'vscode' ? { workspace } : { LanguageClient, TransportKind: { stdio: 0 } },
  });
  module.exports.activate({ asAbsolutePath: (p: string) => p, subscriptions: [] });
  return {
    options, notifications,
    set: (v: typeof values) => { values = v; },
    changed: () => listener({ affectsConfiguration: (name: string) => name === 'dsLanguageServer' }),
  };
}

describe('VS Code settings transport', () => {
  it('does not let extension defaults shadow project configuration', () => {
    const harness = clientHarness();
    harness.set({ languages: { defaultValue: ['html'] }, diagnostics: { defaultValue: { deprecated: 'warning' } } });
    expect(harness.options.initializationOptions()).toEqual({});
    expect(harness.options.documentSelector).toEqual([{ scheme: 'file' }]);
  });
  it('samples explicit settings at initialization and preserves empty-array overrides', () => {
    const harness = clientHarness();
    harness.set({ languages: { globalValue: ['html'], workspaceValue: [], defaultValue: ['css'] } });
    expect(harness.options.initializationOptions()).toEqual({ languages: [] });
  });
  it('uses the actual middleware signature and returns values in request order', async () => {
    const harness = clientHarness();
    harness.set({ classAttributes: { workspaceValue: ['utility'] } });
    const token = {};
    const other = { section: 'other', scopeUri: 'file:///workspace' };
    let delegated: unknown;
    const result = await harness.options.middleware.workspace.configuration({ items: [other, { section: 'dsLanguageServer' }, { section: 'third' }] }, token,
      (params: unknown, received: unknown) => { delegated = params; expect(received).toBe(token); return ['other-value', 'third-value']; });
    expect(delegated).toEqual({ items: [other, { section: 'third' }] });
    expect(result).toEqual(['other-value', { classAttributes: ['utility'] }, 'third-value']);
  });
  it('sends a notification, including a full empty snapshot on reset', () => {
    const harness = clientHarness();
    harness.set({ diagnostics: { workspaceValue: { deprecated: 'error' } } });
    harness.changed();
    harness.set({});
    harness.changed();
    expect(harness.notifications).toEqual([
      { method: 'workspace/didChangeConfiguration', params: { settings: { dsLanguageServer: { diagnostics: { deprecated: 'error' } } } } },
      { method: 'workspace/didChangeConfiguration', params: { settings: { dsLanguageServer: {} } } },
    ]);
  });
  it('merges explicitly set object fields across editor scopes without defaults', () => {
    const harness = clientHarness();
    harness.set({ diagnostics: {
      globalValue: { deprecated: 'warning', packages: { a: { deprecated: 'off' } } },
      workspaceValue: { packages: { b: { deprecated: 'error' } } },
      workspaceFolderValue: { deprecated: 'information' },
      defaultValue: { packages: { unwanted: { deprecated: 'warning' } } },
    } });
    expect(harness.options.initializationOptions()).toEqual({ diagnostics: {
      deprecated: 'information', packages: { a: { deprecated: 'off' }, b: { deprecated: 'error' } },
    } });
  });
});

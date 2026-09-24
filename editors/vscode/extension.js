const path = require('path');
const { workspace } = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

/** @type {import('vscode-languageclient/node').LanguageClient | undefined} */
let client;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Pure recursive merge of two explicit setting values.
 * When both are plain objects, their own keys are merged recursively;
 * otherwise (arrays, primitives, null) the override replaces the base.
 * `undefined` values are omitted. Result keys are defined as own
 * properties so `__proto__`-style keys in user configuration cannot
 * invoke the prototype setter.
 * @param {unknown} base
 * @param {unknown} override
 * @returns {unknown}
 */
function mergeExplicit(base, override) {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const result = Object.create(null);
  const define = (key, value) =>
    Object.defineProperty(result, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  for (const key of Object.keys(base)) {
    if (base[key] === undefined) continue;
    define(key, base[key]);
  }
  for (const key of Object.keys(override)) {
    const value = override[key];
    if (value === undefined) continue;
    const existing = result[key];
    define(
      key,
      isPlainObject(existing) && isPlainObject(value)
        ? mergeExplicit(existing, value)
        : value
    );
  }
  return result;
}

/**
 * Snapshot of explicitly configured dsLanguageServer settings.
 * For each key, the explicit scopes are folded from least to most
 * specific (global, workspace, workspace folder), merging nested
 * object values; defaults are omitted.
 * @returns {Record<string, unknown>}
 */
function explicitSettings() {
  const config = workspace.getConfiguration('dsLanguageServer');
  const keys = ['languages', 'templateTags', 'classAttributes', 'diagnostics'];
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const key of keys) {
    const inspected = config.inspect(key);
    if (!inspected) continue;
    /** @type {unknown} */
    let folded;
    for (const value of [
      inspected.globalValue,
      inspected.workspaceValue,
      inspected.workspaceFolderValue,
    ]) {
      folded = mergeExplicit(folded, value);
    }
    if (folded !== undefined) result[key] = folded;
  }
  return result;
}

function activate(context) {
  const config = workspace.getConfiguration('dsLanguageServer');

  if (!config.get('enable', true)) return;

  // Server path: custom setting or bundled
  const serverModule =
    config.get('serverPath', '') ||
    context.asAbsolutePath(path.join('server', 'server.js'));

  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions = {
    documentSelector: [{ scheme: 'file' }],
    initializationOptions: explicitSettings,
    middleware: {
      workspace: {
        /**
         * Serves `workspace/configuration` requests: the
         * `dsLanguageServer` section is answered with explicitly
         * configured settings (defaults omitted), the rest is
         * delegated.
         * @param {{ items: import('vscode-languageclient/node').ConfigurationItem[] }} params
         * @param {import('vscode').CancellationToken} token
         * @param {(params: { items: import('vscode-languageclient/node').ConfigurationItem[] }, token: import('vscode').CancellationToken) => Promise<unknown[]>} next
         * @returns {Promise<unknown[]>}
         */
        async configuration(params, token, next) {
          const otherItems = params.items.filter(
            (item) => item.section !== 'dsLanguageServer'
          );
          const values = otherItems.length
            ? await next({ items: otherItems }, token)
            : [];
          let otherIndex = 0;
          return params.items.map((item) =>
            item.section === 'dsLanguageServer'
              ? explicitSettings()
              : values[otherIndex++]
          );
        },
      },
    },
  };

  client = new LanguageClient(
    'ds-language-server',
    'Design System Language Server',
    serverOptions,
    clientOptions
  );

  client.start();

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('dsLanguageServer')) {
        client?.sendNotification('workspace/didChangeConfiguration', {
          settings: { dsLanguageServer: explicitSettings() },
        });
      }
    })
  );
  context.subscriptions.push({ dispose: () => client?.stop() });
}

function deactivate() {
  return client?.stop();
}

module.exports = { activate, deactivate };

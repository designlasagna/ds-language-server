const path = require('path');
const { workspace } = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

/** @type {import('vscode-languageclient/node').LanguageClient | undefined} */
let client;

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
    documentSelector: [
      { scheme: 'file', language: 'html' },
      { scheme: 'file', language: 'css' },
      { scheme: 'file', language: 'scss' },
      { scheme: 'file', language: 'javascript' },
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'javascriptreact' },
      { scheme: 'file', language: 'typescriptreact' },
    ],
    synchronize: {
      fileEvents: [
        workspace.createFileSystemWatcher('**/ds.config.{json,js,mjs}'),
        workspace.createFileSystemWatcher('**/custom-elements.json'),
        workspace.createFileSystemWatcher('**/*.manifest.json'),
      ],
    },
  };

  client = new LanguageClient(
    'ds-language-server',
    'Design System Language Server',
    serverOptions,
    clientOptions
  );

  client.start();
  context.subscriptions.push({ dispose: () => client?.stop() });
}

function deactivate() {
  return client?.stop();
}

module.exports = { activate, deactivate };

const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'designlasagna.design-system-language-server';

function log(message) {
  console.log(`[vscode-smoke] ${message}`);
}

async function waitFor(description, operation, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await operation();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${description}; last value: ${JSON.stringify(last)}`);
}

function candidateExtension() {
  return vscode.extensions.all.find((extension) => extension.id.toLowerCase() === EXTENSION_ID);
}

function lifecycleDiagnostic(items, severity) {
  return items.find((item) =>
    item.source === 'ds-language-server'
      && item.severity === severity
      && /deprecated/i.test(item.message));
}

function hoverText(hover) {
  return hover.contents.map((content) =>
    typeof content === 'string' ? content : content.value).join('\n');
}

function isQuickFix(action) {
  return (action.kind?.value ?? action.kind) === vscode.CodeActionKind.QuickFix.value;
}

async function run() {
  const extensionsDir = path.resolve(process.env.DSLS_SMOKE_EXTENSIONS_DIR);
  const repositoryRoot = path.resolve(process.env.DSLS_SMOKE_REPOSITORY_ROOT);
  const extension = candidateExtension();
  assert(extension, `${EXTENSION_ID} is not installed`);
  const extensionPath = path.resolve(extension.extensionPath);
  assert(extensionPath.startsWith(`${extensionsDir}${path.sep}`), `extension loaded from ${extensionPath}, not ${extensionsDir}`);
  assert(!extensionPath.startsWith(`${repositoryRoot}${path.sep}`), `extension loaded from repository: ${extensionPath}`);
  assert.equal(extension.packageJSON.version, process.env.DSLS_SMOKE_VERSION);
  await extension.activate();
  assert.equal(extension.isActive, true);
  log(`PASS activated archived ${extension.packageJSON.version} extension from disposable directory ${extensionPath}`);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert(workspaceFolder, 'smoke workspace was not opened');
  const htmlUri = vscode.Uri.joinPath(workspaceFolder.uri, 'test.html');
  const tokenUri = vscode.Uri.joinPath(workspaceFolder.uri, 'tokens.json');
  const html = await vscode.workspace.openTextDocument(htmlUri);
  await vscode.window.showTextDocument(html);

  const completion = await waitFor(
    'OldButton completion',
    () => vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      htmlUri,
      new vscode.Position(1, 1),
    ),
    (result) => result?.items?.some((item) => item.label === 'OldButton'),
  );
  assert(completion.items.some((item) => item.label === 'OldButton'));
  log('PASS archived extension client/server returns fixture component completion OldButton');

  const hovers = await waitFor(
    'archived component hover',
    () => vscode.commands.executeCommand(
      'vscode.executeHoverProvider',
      htmlUri,
      new vscode.Position(0, 2),
    ),
    (result) => result?.some((hover) => /### `<old-button>`/.test(hoverText(hover))),
  );
  const hover = hovers.find((item) => /### `<old-button>`/.test(hoverText(item)));
  assert.match(hoverText(hover), /Archived smoke component\./);
  assert.match(hoverText(hover), /\*\*Deprecated\*\*/);
  assert.match(hoverText(hover), /\*\*Replacement:\*\* `current-button`/);
  log('PASS archived extension host returns component hover and deprecation content');

  const initialDiagnostics = await waitFor(
    'Information lifecycle diagnostic from workspace setting',
    () => Promise.resolve(vscode.languages.getDiagnostics(htmlUri)),
    (items) => Boolean(lifecycleDiagnostic(items, vscode.DiagnosticSeverity.Information)),
  );
  assert(lifecycleDiagnostic(initialDiagnostics, vscode.DiagnosticSeverity.Information));
  log('PASS workspace setting was forwarded at activation (Information diagnostic overrides file off)');

  const quickFixUri = vscode.Uri.joinPath(workspaceFolder.uri, 'quick-fix.html');
  const quickFixDocument = await vscode.workspace.openTextDocument(quickFixUri);
  const quickFixDiagnostics = await waitFor(
    'safe deprecated attribute-value diagnostic',
    () => Promise.resolve(vscode.languages.getDiagnostics(quickFixUri)),
    (items) => items.some((item) => item.source === 'ds-language-server' && /tone="legacy"/.test(item.message)),
  );
  const quickFixDiagnostic = quickFixDiagnostics.find((item) =>
    item.source === 'ds-language-server' && /tone="legacy"/.test(item.message));
  const codeActions = await waitFor(
    'safe deprecated attribute-value quick fix',
    () => vscode.commands.executeCommand(
      'vscode.executeCodeActionProvider',
      quickFixUri,
      quickFixDiagnostic.range,
      vscode.CodeActionKind.QuickFix.value,
    ),
    (result) => result?.some((action) => isQuickFix(action)
      && action.title === 'Replace "legacy" with "modern"' && action.edit),
  );
  const quickFix = codeActions.find((action) => isQuickFix(action)
    && action.title === 'Replace "legacy" with "modern"' && action.edit);
  const edits = quickFix.edit.get(quickFixUri);
  assert.deepEqual(edits.map((edit) => ({ range: edit.range, newText: edit.newText })), [{
    range: quickFixDiagnostic.range,
    newText: 'modern',
  }]);
  assert.equal(await vscode.workspace.applyEdit(quickFix.edit), true);
  assert.equal(quickFixDocument.getText(), '<old-button tone="modern"></old-button>\n');
  log('PASS archived extension host requested and applied safe attribute-value quick fix');

  await vscode.workspace.openTextDocument(tokenUri);
  const schemaDiagnostics = await waitFor(
    'packaged schema diagnostic',
    () => Promise.resolve(vscode.languages.getDiagnostics(tokenUri)),
    (items) => items.some((item) => item.source === 'designlasagna-schema' && item.code === 'schema-manifest'),
  );
  assert(schemaDiagnostics.some((item) => item.source === 'designlasagna-schema' && item.code === 'schema-manifest'));
  log('PASS archived extension host loads packaged schema dependencies');

  await vscode.workspace.getConfiguration('dsLanguageServer').update(
    'diagnostics',
    { deprecated: 'error' },
    vscode.ConfigurationTarget.Workspace,
  );
  const reloadedDiagnostics = await waitFor(
    'Error lifecycle diagnostic after setting update',
    () => Promise.resolve(vscode.languages.getDiagnostics(htmlUri)),
    (items) => Boolean(lifecycleDiagnostic(items, vscode.DiagnosticSeverity.Error)),
  );
  assert(lifecycleDiagnostic(reloadedDiagnostics, vscode.DiagnosticSeverity.Error));
  log('PASS setting change was forwarded and reloaded (Error diagnostic)');
  log('PASS all extension-host assertions');
}

module.exports = { run };

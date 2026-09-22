#!/usr/bin/env node

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  CompletionParams,
  HoverParams,
  CodeActionParams,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DSStore } from './store.js';
import { discover, loadConfig } from './discovery.js';
import { getCursorContext } from './scanner.js';
import { getCompletions } from './providers/completion.js';
import { getHover } from './providers/hover.js';
import { getDiagnostics } from './providers/diagnostics.js';
import { getSchemaDiagnostics } from './providers/schema-diagnostics.js';
import { getCodeActions } from './providers/code-actions.js';
import { URI } from 'vscode-uri';
import type { DSConfig } from './types.js';
import { WatchManager, type WatchRegistrationAdapter } from './watching.js';

// ─── Create connection ─────────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const store = new DSStore();
let config: DSConfig | undefined;
let workspaceRoot = '';
let manifestsLoaded = false;
let reloadGeneration = 0;
let shuttingDown = false;
let tokenDocumentUris = new Set<string>();
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
let watchManager: WatchManager | undefined;
let configurationRegistration: { dispose(): void } | undefined;
let supportsDynamicConfiguration = false;
const VALIDATION_DEBOUNCE_MS = 300;

// ─── Initialize ────────────────────────────────────────────────────

connection.onInitialize((params: InitializeParams) => {
  workspaceRoot = params.rootUri
    ? URI.parse(params.rootUri).fsPath
    : params.rootPath ?? process.cwd();

  const watchedFiles = params.capabilities.workspace?.didChangeWatchedFiles;
  supportsDynamicConfiguration = params.capabilities.workspace?.didChangeConfiguration?.dynamicRegistration === true;
  const registrationAdapter: WatchRegistrationAdapter | undefined = watchedFiles?.dynamicRegistration
    ? {
        relativePatternSupport: watchedFiles.relativePatternSupport,
        register: async (options) => connection.client.register(
          DidChangeWatchedFilesNotification.type,
          options,
        ),
      }
    : undefined;
  watchManager = new WatchManager(() => {
    // Polling and client notifications can be coalesced by WatchManager. Always
    // reload config so an unclassified polling signal cannot be hidden by a
    // manifest-only client event, and so workspace package.json type changes
    // are reflected by the JavaScript config loader.
    void reloadConfiguration().catch(reportAsyncError);
  }, {
    registrationAdapter,
    onError: reportAsyncError,
  });

  console.error(`[ds-ls] Initializing for workspace: ${workspaceRoot}`);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['<', ' ', '"', "'", '-', '(', '.'],
        resolveProvider: false,
      },
      hoverProvider: true,
      codeActionProvider: true,
    },
  };
});

connection.onInitialized(() => {
  void initializeServer().catch(reportAsyncError);
});

async function initializeServer(): Promise<void> {
  await reloadConfiguration();
  if (supportsDynamicConfiguration && !shuttingDown) {
    try {
      const registration = await connection.client.register(
        DidChangeConfigurationNotification.type,
        undefined,
      );
      if (shuttingDown) registration.dispose();
      else configurationRegistration = registration;
    } catch (error) {
      reportAsyncError(error);
    }
  }
}

async function reloadConfiguration(): Promise<void> {
  // Every request starts a fresh config load. Only config loads advance this
  // generation, so a later request always preserves the intent to reload and
  // a slow, older import can never overwrite it.
  const generation = ++reloadGeneration;
  const loadedConfig = await loadConfig(workspaceRoot);

  // A slower, older module import must not overwrite a newer reload.
  if (generation !== reloadGeneration || shuttingDown) {
    console.error('[ds-ls] Ignoring superseded configuration reload');
    return;
  }

  config = loadedConfig;
  console.error(`[ds-ls] Discovering manifests in ${workspaceRoot}`);

  const result = discover(workspaceRoot, config);
  tokenDocumentUris = new Set(result.sources.tokens.map((source) => URI.file(source.path).toString()));
  store.load(result.sources, config);
  manifestsLoaded = true;

  const stats = store.stats();
  console.error(
    `[ds-ls] Ready: ${stats.components} components, ` +
    `${stats.tokens} tokens, ${stats.utilities} utilities`,
  );

  // Re-validate all open documents after their manifest sources change.
  for (const doc of documents.all()) {
    scheduleDocumentValidation(doc);
  }

  // The next registration must describe the sources selected by this reload.
  await watchManager?.update(result.watchTargets);
}

// ─── Completions ───────────────────────────────────────────────────

connection.onCompletion((params: CompletionParams) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const offset = document.offsetAt(params.position);
  const context = getCursorContext(document, offset);

  const items = getCompletions(context, store);
  return items;
});

// ─── Hover ─────────────────────────────────────────────────────────

connection.onHover((params: HoverParams) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  return getHover(document, params.position, store);
});

// ─── Diagnostics ───────────────────────────────────────────────────

function validateDocument(document: TextDocument): void {
  const diagnostics = [
    ...getDiagnostics(document, store, config),
    ...(tokenDocumentUris.has(document.uri) ? getSchemaDiagnostics(document) : []),
  ];
  console.error(`[ds-ls] Validated ${document.uri}: ${diagnostics.length} diagnostics`);
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics,
  });
}

function scheduleDocumentValidation(document: TextDocument): void {
  const existing = validationTimers.get(document.uri);
  if (existing) clearTimeout(existing);

  validationTimers.set(document.uri, setTimeout(() => {
    validationTimers.delete(document.uri);
    if (manifestsLoaded) validateDocument(document);
  }, VALIDATION_DEBOUNCE_MS));
}

documents.onDidChangeContent((change) => {
  scheduleDocumentValidation(change.document);
});

documents.onDidOpen((event) => {
  scheduleDocumentValidation(event.document);
});

documents.onDidClose((event) => {
  const timer = validationTimers.get(event.document.uri);
  if (timer) clearTimeout(timer);
  validationTimers.delete(event.document.uri);
  connection.sendDiagnostics({
    uri: event.document.uri,
    diagnostics: [],
  });
});

// ─── Code Actions ──────────────────────────────────────────────────

connection.onCodeAction((params: CodeActionParams) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  return getCodeActions(document, params.context.diagnostics);
});

// ─── Configuration changes ─────────────────────────────────────────

connection.onDidChangeConfiguration(() => {
  void reloadConfiguration().catch(reportAsyncError);
});

// ─── File watching ─────────────────────────────────────────────────

connection.onDidChangeWatchedFiles(() => {
  watchManager?.notifyChange();
});

function clearValidationTimers(): void {
  for (const timer of validationTimers.values()) clearTimeout(timer);
  validationTimers.clear();
}

function reportAsyncError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[ds-ls] Async error: ${message}`);
}

function disposeConfigurationRegistration(): void {
  try {
    configurationRegistration?.dispose();
  } catch (error) {
    reportAsyncError(error);
  }
  configurationRegistration = undefined;
}

async function disposeServer(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  ++reloadGeneration;
  clearValidationTimers();
  disposeConfigurationRegistration();
  await watchManager?.dispose();
}

connection.onShutdown(disposeServer);
connection.onExit(() => {
  void disposeServer().catch(reportAsyncError);
});
// The connection API does not expose its transport-close event. Dispose on a
// stdio disconnect as well, including clients that omit the exit notification.
process.stdin.on('close', () => {
  void disposeServer().catch(reportAsyncError);
});

// ─── Start ─────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();

console.error('[ds-ls] Design System Language Server started');

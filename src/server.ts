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
  DidChangeConfigurationParams,
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
import { resolveConfiguration } from './configuration.js';
import { isLanguageEnabled } from './recognition-settings.js';

// Section name of the contributed editor settings (see editors/vscode/
// package.json "dsLanguageServer.*" properties). Used to fetch the scoped
// settings from clients that support workspace/configuration.
const CONFIG_SECTION = 'dsLanguageServer';

// ─── Create connection ─────────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const store = new DSStore();
let config: DSConfig | undefined;
let workspaceRoot = '';
let manifestsLoaded = false;
let reloadGeneration = 0;
let settingsFetchGeneration = 0;
let shuttingDown = false;
let tokenDocumentUris = new Set<string>();
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
let watchManager: WatchManager | undefined;
let configurationRegistration: { dispose(): void } | undefined;
let supportsDynamicConfiguration = false;
// Only clients that explicitly advertise workspace.configuration support
// the workspace/configuration request. Other clients are never queried.
let supportsWorkspaceConfiguration = false;
// Editor settings snapshot. Seeded from initializationOptions, then replaced
// wholesale by either a workspace/configuration fetch or a
// didChangeConfiguration settings payload. Never accumulated.
let editorSettings: unknown;
const VALIDATION_DEBOUNCE_MS = 300;

// ─── Initialize ────────────────────────────────────────────────────

connection.onInitialize((params: InitializeParams) => {
  workspaceRoot = params.rootUri
    ? URI.parse(params.rootUri).fsPath
    : params.rootPath ?? process.cwd();

  const watchedFiles = params.capabilities.workspace?.didChangeWatchedFiles;
  supportsDynamicConfiguration = params.capabilities.workspace?.didChangeConfiguration?.dynamicRegistration === true;
  supportsWorkspaceConfiguration = params.capabilities.workspace?.configuration === true;
  editorSettings = settingsFromPayload(params.initializationOptions);
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
        triggerCharacters: ['<', ' ', '"', "'", '-', '(', '.', '@'],
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
  // Supporting clients are the source of truth for editor settings: the
  // fetched section replaces the initializationOptions snapshot. A rejected
  // fetch keeps the initializationOptions snapshot instead.
  if (supportsWorkspaceConfiguration && !shuttingDown) {
    await fetchEditorSettings();
  }
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

  // File settings form the base; the current editor settings snapshot
  // overrides them. Merging after the load (and after the generation check)
  // means the newest snapshot always wins and every reload — including
  // file-watcher-triggered ones — preserves the current editor settings.
  config = resolveConfiguration(loadedConfig, editorSettings);
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
  const context = getCursorContext(document, offset, config);

  const items = getCompletions(context, store);
  return items;
});

// ─── Hover ─────────────────────────────────────────────────────────

connection.onHover((params: HoverParams) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  return getHover(document, params.position, store, config);
});

// ─── Diagnostics ───────────────────────────────────────────────────

function validateDocument(document: TextDocument): void {
  const diagnostics = [
    ...getDiagnostics(document, store, config),
    ...(tokenDocumentUris.has(document.uri) ? getSchemaDiagnostics(document, config?.lifecycle?.profile) : []),
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
  if (!isLanguageEnabled(document.languageId, config)) return [];

  return getCodeActions(document, params.context.diagnostics);
});

// ─── Configuration changes ─────────────────────────────────────────

connection.onDidChangeConfiguration((params) => {
  void applyConfigurationChange(params).catch(reportAsyncError);
});

async function applyConfigurationChange(params: DidChangeConfigurationParams): Promise<void> {
  if (supportsWorkspaceConfiguration) {
    // Supporting clients are the source of truth: refetch the scoped section.
    // A rejected fetch reports the error and retains the prior snapshot.
    await fetchEditorSettings();
  } else {
    // Unsupported clients send the settings in the notification itself.
    // Replacement, not accumulation: an empty `{}` resets to file-only.
    editorSettings = settingsFromPayload(params.settings);
  }
  if (shuttingDown) return;
  await reloadConfiguration();
}

/**
 * Unwrap the editor settings payload. Accepts either the section wrapper
 * (`{ dsLanguageServer: {...} }`) or the settings object directly. The
 * result replaces the snapshot wholesale.
 */
function settingsFromPayload(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const section = (payload as Record<string, unknown>)[CONFIG_SECTION];
  if (typeof section === 'object' && section !== null && !Array.isArray(section)) return section;
  return payload;
}

/**
 * Fetch the scoped editor settings section from the client. Never starts a
 * new request during shutdown. Each fetch advances the generation, so only
 * the latest in-flight request may assign the snapshot; shutdown
 * invalidates all in-flight fetches. On rejection the prior snapshot is
 * retained.
 */
async function fetchEditorSettings(): Promise<void> {
  if (shuttingDown) return;
  const generation = ++settingsFetchGeneration;
  let fetched: unknown;
  try {
    fetched = await connection.workspace.getConfiguration(CONFIG_SECTION);
  } catch (error) {
    reportAsyncError(error);
    return;
  }
  // A slower, older fetch must not overwrite the snapshot once a newer
  // fetch (or shutdown) has invalidated it.
  if (generation !== settingsFetchGeneration) return;
  // Some clients (e.g. Zed) answer workspace/configuration with the section
  // wrapper `{ dsLanguageServer: {...} }` rather than the section value.
  editorSettings = settingsFromPayload(fetched);
}

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
  ++settingsFetchGeneration;
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

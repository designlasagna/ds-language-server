#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
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
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DSStore } from './store.js';
import { discoverManifests } from './discovery.js';
import { getCursorContext } from './scanner.js';
import { getCompletions } from './providers/completion.js';
import { getHover } from './providers/hover.js';
import { getDiagnostics } from './providers/diagnostics.js';
import { getCodeActions } from './providers/code-actions.js';
import type { DSConfig } from './types.js';

// ─── Create connection ─────────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const store = new DSStore();
let config: DSConfig | undefined;
let workspaceRoot = '';
let manifestsLoaded = false;

// ─── Initialize ────────────────────────────────────────────────────

connection.onInitialize((params: InitializeParams) => {
  workspaceRoot = params.rootUri
    ? new URL(params.rootUri).pathname
    : params.rootPath ?? process.cwd();

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
  // Try to load ds.config.json synchronously
  const configPath = path.join(workspaceRoot, 'ds.config.json');
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      console.error('[ds-ls] Loaded ds.config.json');
    } catch (e) {
      console.error(`[ds-ls] Failed to parse ds.config.json: ${e}`);
    }
  }

  // Discover and load manifests
  loadManifests();

  // Register for configuration changes
  connection.client.register(DidChangeConfigurationNotification.type, undefined);
});

function loadManifests(): void {
  console.error(`[ds-ls] Discovering manifests in ${workspaceRoot}`);

  const sources = discoverManifests(workspaceRoot, config);
  store.load(sources);
  manifestsLoaded = true;

  const stats = store.stats();
  console.error(
    `[ds-ls] Ready: ${stats.components} components, ` +
    `${stats.tokens} tokens, ${stats.utilities} utilities`,
  );

  // Re-validate all open documents
  for (const doc of documents.all()) {
    validateDocument(doc);
  }
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
  const diagnostics = getDiagnostics(document, store, config);
  console.error(`[ds-ls] Validated ${document.uri}: ${diagnostics.length} diagnostics`);
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics,
  });
}

documents.onDidChangeContent((change) => {
  if (manifestsLoaded) {
    validateDocument(change.document);
  }
});

documents.onDidOpen((event) => {
  if (manifestsLoaded) {
    validateDocument(event.document);
  }
});

documents.onDidClose((event) => {
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
  const configPath = path.join(workspaceRoot, 'ds.config.json');
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // ignore
    }
  }
  loadManifests();
});

// ─── File watching ─────────────────────────────────────────────────

connection.onDidChangeWatchedFiles(() => {
  loadManifests();
});

// ─── Start ─────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();

console.error('[ds-ls] Design System Language Server started');

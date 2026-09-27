#!/usr/bin/env node
/**
 * Generate the retained third-party license notices for the VS Code
 * extension.
 *
 * Every production dependency in the lockfile ships inside the archive:
 * either compiled into client/extension.cjs / server/server.js (ajv,
 * ajv-formats, jsonc-parser, and the client's vscode-languageclient
 * closure) or installed as an external runtime package
 * (@designlasagna/schemas). This script renders the license notice for each
 * one from the installed packages and the lockfile into
 * licenses/THIRD-PARTY-NOTICES.md. scripts/validate-package.mjs regenerates
 * the same content and fails if the archived file is stale.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTICES_PATH, renderNotices, shippedClosureWithText } from './validate-package.mjs';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(path.join(extensionRoot, 'package-lock.json'), 'utf8'));

const { entries, problems } = shippedClosureWithText(lock);
if (problems.length) {
  console.error('generate-notices failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
mkdirSync(path.join(extensionRoot, path.dirname(NOTICES_PATH)), { recursive: true });
writeFileSync(path.join(extensionRoot, NOTICES_PATH), renderNotices(entries));
console.log(`generate-notices: wrote ${NOTICES_PATH} with ${entries.length} package notices`);

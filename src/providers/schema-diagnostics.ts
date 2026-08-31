import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  findNodeAtLocation,
  parse,
  parseTree,
  ParseError,
  printParseErrorCode,
  type Node as JsonNode,
} from 'jsonc-parser';
import { validateTokenDocument } from '../schema-validation.js';

const SOURCE = 'designlasagna-schema';

/**
 * Convert JSON/JSONC parse and schema errors into precise LSP diagnostics.
 * Call this only for a file declared as `designSystem.tokens`.
 */
export function getSchemaDiagnostics(document: TextDocument): Diagnostic[] {
  const text = document.getText();
  const parseErrors: ParseError[] = [];
  const value = parse(text, parseErrors, { allowTrailingComma: true, disallowComments: false });

  if (parseErrors.length > 0) {
    return parseErrors.map((error) => ({
      range: offsetRange(document, error.offset, Math.max(error.length, 1)),
      severity: DiagnosticSeverity.Error,
      source: SOURCE,
      code: 'invalid-json',
      message: `Invalid JSON: ${printParseErrorCode(error.error)}`,
    }));
  }

  const root = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
  if (!root) {
    return [{
      range: offsetRange(document, 0, Math.max(text.length, 1)),
      severity: DiagnosticSeverity.Error,
      source: SOURCE,
      code: 'invalid-json',
      message: 'Invalid JSON: unable to parse token document.',
    }];
  }

  return validateTokenDocument(value).map((error) => ({
    range: schemaErrorRange(document, root, error.instancePath, error.keyword, error.params),
    severity: DiagnosticSeverity.Error,
    source: SOURCE,
    code: `schema-${error.schema}`,
    message: formatSchemaError(error.keyword, error.message, error.params),
  }));
}

function schemaErrorRange(
  document: TextDocument,
  root: JsonNode,
  pointer: string,
  keyword: string,
  params: Record<string, unknown>,
): Range {
  if (keyword === 'required') {
    const node = findNodeAtLocation(root, pointerToPath(pointer)) ?? root;
    if (node.type === 'object') {
      // Point at the closing brace: this is where the missing property belongs.
      return offsetRange(document, node.offset + Math.max(node.length - 1, 0), 0);
    }
  }

  if (keyword === 'additionalProperties' && typeof params.additionalProperty === 'string') {
    return pointerRange(document, root, `${pointer}/${escapePointerSegment(params.additionalProperty)}`);
  }

  return pointerRange(document, root, pointer);
}

function pointerRange(document: TextDocument, root: JsonNode, pointer: string): Range {
  const path = pointerToPath(pointer);
  const node = findNodeAtLocation(root, path) ?? root;
  return offsetRange(document, node.offset, Math.max(node.length, 1));
}

function formatSchemaError(
  keyword: string,
  fallback: string,
  params: Record<string, unknown>,
): string {
  switch (keyword) {
    case 'required':
      return `Missing required property \`${String(params.missingProperty)}\`.`;
    case 'type':
      return `Expected ${article(String(params.type))} \`${String(params.type)}\` value.`;
    case 'enum':
      return Array.isArray(params.allowedValues)
        ? `Expected one of: ${params.allowedValues.map((value) => `\`${String(value)}\``).join(', ')}.`
        : 'Expected one of the allowed values.';
    case 'additionalProperties':
      return `Property \`${String(params.additionalProperty)}\` is not allowed.`;
    default:
      return fallback === 'is invalid' ? 'Invalid value.' : fallback;
  }
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function pointerToPath(pointer: string): (string | number)[] {
  if (!pointer) return [];
  return pointer.slice(1).split('/').map((segment) => {
    const decoded = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    return /^0$|^[1-9]\d*$/.test(decoded) ? Number(decoded) : decoded;
  });
}

function offsetRange(document: TextDocument, offset: number, length: number): Range {
  return {
    start: document.positionAt(offset),
    end: document.positionAt(offset + length),
  };
}

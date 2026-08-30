/** The supported JSON document shapes referenced by `designSystem.tokens`. */
export type TokenDocumentFormat = 'manifest' | 'dtcg' | 'unknown';

/**
 * Classify a parsed token document without requiring a `$schema` declaration.
 *
 * A Design Lasagna manifest always owns a top-level `tokens` array. An authored
 * DTCG document is an object tree; a group named `tokens` remains an object and
 * must therefore be treated as DTCG source.
 */
export function detectTokenDocumentFormat(document: unknown): TokenDocumentFormat {
  if (!isRecord(document)) return 'unknown';
  return Array.isArray(document.tokens) ? 'manifest' : 'dtcg';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

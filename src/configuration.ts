import type { DSConfig } from './types.js';

/**
 * Severity levels accepted for `diagnostics.deprecated` and
 * `diagnostics.packages[<name>].deprecated`. Derived from DSConfig so the
 * literals cannot drift apart.
 */
type DiagnosticsConfig = NonNullable<DSConfig['diagnostics']>;
export type DeprecatedSeverity = NonNullable<DiagnosticsConfig['deprecated']>;

/**
 * The only fields an editor may override through `workspace/didChangeConfiguration`.
 *
 * Everything else in DSConfig is file configuration only (`ds.config.json/js/mjs`):
 * `sources`, `discovery`, `lifecycle`, and `diagnostics.draftUsage` can never be
 * set from editor settings. `diagnostics.draftUsage` is consumed by the diagnostics
 * provider but is deliberately excluded from this allowlist.
 *
 * Overlay semantics:
 * - Arrays (`languages`, `templateTags.html`, `templateTags.css`,
 *   `classAttributes`) replace the file value wholesale; an explicit `[]` survives.
 * - Nested objects (`templateTags`, `diagnostics`, `diagnostics.packages`) merge
 *   per field / per package, so a missing editor field keeps the file value.
 * - Invalid shapes, types, and enum values are ignored (treated as absent), so
 *   hostile or malformed editor settings can never crash the resolver.
 */
export interface EditorRecognitionSettings {
  languages?: string[];
  templateTags?: {
    html?: string[];
    css?: string[];
  };
  classAttributes?: string[];
  diagnostics?: {
    deprecated?: DeprecatedSeverity;
    packages?: Record<string, {
      deprecated?: DeprecatedSeverity;
    }>;
  };
}

const DEPRECATED_SEVERITIES: readonly string[] = ['auto', 'off', 'information', 'warning', 'error'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isDeprecatedSeverity(value: unknown): value is DeprecatedSeverity {
  return typeof value === 'string' && DEPRECATED_SEVERITIES.includes(value);
}

/**
 * Deep-copy plain config data so the resolver never shares (or mutates) nested
 * arrays/objects with its inputs. Unknown value types (functions from JS config,
 * dates, ...) are carried over by reference.
 */
function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      // defineProperty keeps a JSON-style "__proto__" key a data property.
      Object.defineProperty(result, key, {
        value: cloneValue(value[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  }
  return value;
}

/**
 * Resolve the effective configuration for one configuration generation.
 *
 * Precedence, lowest to highest:
 * 1. Built-in consumer defaults. The resolver does not materialize them; it
 *    simply leaves fields absent, and consumers keep their existing fallbacks
 *    (discovery enabled by default, `diagnostics.deprecated` auto by default,
 *    legacy lifecycle profile by default). No default is ever injected.
 * 2. The workspace `ds.config.*` (`fileConfig`).
 * 3. Explicitly supplied editor settings (`editorSettings`), restricted to the
 *    EditorRecognitionSettings allowlist.
 *
 * The result is a fresh DSConfig: neither input is mutated, nested arrays and
 * objects are copied, and an absent/undefined editor setting — including a
 * fresh `{}` — resets the editor layer back to the file values. Pure function,
 * no accumulated state.
 */
export function resolveConfiguration(
  fileConfig: DSConfig | undefined,
  editorSettings: unknown,
): DSConfig {
  const config: Record<string, unknown> = isRecord(fileConfig)
    ? (cloneValue(fileConfig) as Record<string, unknown>)
    : {};
  const editor: Record<string, unknown> = isRecord(editorSettings) ? editorSettings : {};

  if (isStringArray(editor.languages)) config.languages = [...editor.languages];
  if (isStringArray(editor.classAttributes)) config.classAttributes = [...editor.classAttributes];

  if (isRecord(editor.templateTags)) {
    const templateTags: Record<string, unknown> = isRecord(config.templateTags)
      ? { ...config.templateTags }
      : {};
    let applied = isRecord(config.templateTags);
    if (isStringArray(editor.templateTags.html)) {
      templateTags.html = [...editor.templateTags.html];
      applied = true;
    }
    if (isStringArray(editor.templateTags.css)) {
      templateTags.css = [...editor.templateTags.css];
      applied = true;
    }
    if (applied) config.templateTags = templateTags;
  }

  if (isRecord(editor.diagnostics)) {
    const diagnostics: Record<string, unknown> = isRecord(config.diagnostics)
      ? { ...config.diagnostics }
      : {};
    let applied = isRecord(config.diagnostics);
    if (isDeprecatedSeverity(editor.diagnostics.deprecated)) {
      diagnostics.deprecated = editor.diagnostics.deprecated;
      applied = true;
    }
    if (isRecord(editor.diagnostics.packages)) {
      const filePackages: Record<string, unknown> = isRecord(diagnostics.packages)
        ? { ...diagnostics.packages }
        : {};
      const packages: Record<string, Record<string, unknown>> = {};
      const definePackage = (packageName: string, entry: Record<string, unknown>) => {
        // Assignment to "__proto__" on an ordinary object invokes its legacy
        // prototype setter. Define map entries as own data properties instead.
        Object.defineProperty(packages, packageName, {
          value: entry,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      };
      for (const [packageName, entry] of Object.entries(filePackages)) {
        definePackage(packageName, isRecord(entry) ? { ...entry } : {});
      }
      let packageApplied = Object.keys(filePackages).length > 0;
      for (const [packageName, entry] of Object.entries(editor.diagnostics.packages)) {
        if (!isRecord(entry) || !isDeprecatedSeverity(entry.deprecated)) continue;
        const existing = Object.prototype.hasOwnProperty.call(packages, packageName)
          ? packages[packageName]
          : undefined;
        definePackage(packageName, { ...(existing ?? {}), deprecated: entry.deprecated });
        packageApplied = true;
      }
      if (packageApplied) {
        diagnostics.packages = packages;
        applied = true;
      }
    }
    if (applied) config.diagnostics = diagnostics;
  }

  // Editor keys outside the allowlist (sources, discovery, lifecycle,
  // diagnostics.draftUsage, anything unknown) are intentionally ignored.
  return config as DSConfig;
}

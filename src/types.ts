// ─── Lifecycle (shared across all items) ───────────────────────────

export type Status = 'draft' | 'beta' | 'ready' | 'deprecated';

export interface LifecycleInfo {
  status?: Status;
  deprecated?: boolean;
  deprecationMessage?: string;
  /** ISO date (2026-07-30) or semver (v4.0.0) */
  removal?: string;
  /** Name of the replacement (token, class, attribute value) */
  replacement?: string;
}

// ─── Components ────────────────────────────────────────────────────

export interface DSComponent extends LifecycleInfo {
  tagName: string;
  className: string;
  description: string;
  attributes: DSAttribute[];
  slots: DSSlot[];
  events: DSEvent[];
  cssProperties: DSCssProperty[];
  cssParts: DSCssPart[];
  /** Package this component was discovered from */
  source: string;
}

export interface DSAttribute extends LifecycleInfo {
  name: string;
  type: string;
  default?: string;
  description?: string;
  /** Attribute name in HTML (may differ from JS property name, e.g., help-text vs helpText) */
  htmlName: string;
  /** Allowed enum values */
  values?: string[];
  /** Deprecated individual values */
  deprecatedValues?: DSDeprecatedValue[];
}

export interface DSDeprecatedValue {
  value: string;
  message: string;
  removal?: string;
  replacement?: string;
}

export interface DSSlot {
  name: string;
  description?: string;
}

export interface DSEvent {
  name: string;
  description?: string;
  type?: string;
}

export interface DSCssProperty extends LifecycleInfo {
  name: string;
  description?: string;
  default?: string;
  syntax?: string;
}

export interface DSCssPart {
  name: string;
  description?: string;
}

// ─── Tokens ────────────────────────────────────────────────────────

export interface DSToken extends LifecycleInfo {
  /** CSS variable name, e.g., --lfds-spacing-lg */
  name: string;
  description?: string;
  group?: string;
  category?: string;
  type?: string;
  /** Resolved values per mode */
  resolved?: Record<string, string>;
  /** Default resolved value */
  value?: string;
  /** Package this token was discovered from */
  source: string;
}

// ─── Utility Classes ───────────────────────────────────────────────

export interface DSUtilityClass extends LifecycleInfo {
  name: string;
  description?: string;
  category?: string;
  /** Related token names */
  relatedTokens?: string[];
  /** Package this class was discovered from */
  source: string;
}

// ─── Discovery ─────────────────────────────────────────────────────

export interface ManifestSources {
  components: ManifestFile[];
  tokens: ManifestFile[];
  utilities: ManifestFile[];
}

export interface ManifestFile {
  /** Absolute file path */
  path: string;
  /** Package name (from package.json) */
  packageName: string;
}

// ─── Configuration ─────────────────────────────────────────────────

export interface DSConfig {
  sources?: {
    components?: string[];
    tokens?: string[];
    utilities?: string[];
  };
  diagnostics?: {
    deprecated?: 'auto' | 'off' | 'information' | 'warning' | 'error';
    draftUsage?: 'off' | 'information' | 'warning';
    packages?: Record<string, {
      deprecated?: 'auto' | 'off' | 'information' | 'warning' | 'error';
    }>;
  };
  languages?: string[];
  templateTags?: {
    html?: string[];
    css?: string[];
  };
  classAttributes?: string[];
}

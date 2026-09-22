// ─── Lifecycle (shared across all items) ───────────────────────────

/** Design Lasagna permits arbitrary lifecycle status strings. */
export type Status = string;

export type LifecycleState = 'active' | 'deprecated' | 'removed';
export type LifecycleAssertion = 'absent' | 'explicit-false' | 'positive';
export type LifecycleIssue =
  | 'lifecycle-conflict'
  | 'bare-deprecation'
  | 'deprecation-message-mismatch'
  | 'unresolved-replacement'
  | 'ambiguous-replacement'
  | 'unresolved-extends'
  | 'extends-cycle';

export interface LifecycleInfo {
  /** Raw author status. Only deprecated and removed have lifecycle meaning. */
  status?: Status;
  /** Compatibility projection for existing providers; use lifecycleState for v0.4 semantics. */
  deprecated?: boolean;
  deprecationMessage?: string;
  /** ISO date (2026-07-30) or semver (v4.0.0) */
  removal?: string;
  /** Name of the replacement (token, class, attribute value) */
  replacement?: string;
  lifecycleState?: LifecycleState;
  lifecycleAssertion?: LifecycleAssertion;
  lifecycleIssues?: LifecycleIssue[];
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

export interface DSSlot extends LifecycleInfo {
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
  /** Canonical manifest identifier, used to resolve v0.4 replacements. */
  id?: string;
  /** CSS variable name, e.g., --acme-spacing-lg */
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
  /** Additional manifest files to load (merged with auto-discovered manifests). */
  sources?: {
    components?: string[];
    tokens?: string[];
    utilities?: string[];
  };
  /** Control auto-discovery from node_modules. */
  discovery?: {
    /** Set to false to disable node_modules scanning entirely. Default: true. */
    enabled?: boolean;
    /** Package names to scan (allowlist). Only these packages are scanned in node_modules.
     *  Supports scoped packages (e.g. '@acme/design-system').
     *  If omitted, all packages are scanned. */
    packages?: string[];
  };
  /** CEM/DTCG require this explicit opt-in; absent preserves legacy parsing. */
  lifecycle?: { profile?: '0.4' };
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

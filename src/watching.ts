import * as fs from 'node:fs';
import * as path from 'node:path';
import { URI } from 'vscode-uri';
import type {
  DidChangeWatchedFilesRegistrationOptions,
  FileSystemWatcher,
  GlobPattern,
} from 'vscode-languageserver-protocol';
import type { DiscoveryWatchTargets } from './discovery.js';

/** A dynamic watched-files registration returned by an LSP client. */
export interface WatchRegistration {
  dispose(): Promise<void> | void;
}

/**
 * Adapter for an LSP client's dynamic watched-files registration facility.
 * Only provide this adapter when the client advertises dynamicRegistration.
 */
export interface WatchRegistrationAdapter {
  relativePatternSupport?: boolean;
  register(options: DidChangeWatchedFilesRegistrationOptions): Promise<WatchRegistration>;
}

export interface WatchManagerOptions {
  registrationAdapter?: WatchRegistrationAdapter;
  debounceMs?: number;
  pollingIntervalMs?: number;
  onError?: (error: unknown) => void;
}

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_POLLING_INTERVAL_MS = 750;

/** Escape a literal path segment/path for use in an LSP glob pattern. */
export function escapeGlobLiteral(value: string): string {
  const literals: Record<string, string> = {
    '*': '[*]',
    '?': '[?]',
    '{': '[{]',
    '}': '[}]',
    '[': '[[]',
    ']': '[]]',
    // Backslash is a valid filename character on POSIX. Two backslashes inside
    // the character class keep it literal rather than escaping the closing ].
    '\\': '[\\\\]',
  };
  return [...value].map(character => literals[character] ?? character).join('');
}

function globPath(value: string): string {
  return escapeGlobLiteral(value.split(path.sep).join('/'));
}

function normalizeTargets(targets: DiscoveryWatchTargets): DiscoveryWatchTargets {
  const normalize = (values: string[]): string[] => [...new Set(values.map(value => path.resolve(value)))]
    .sort((a, b) => a.localeCompare(b));

  return {
    files: normalize(targets.files),
    directories: normalize(targets.directories),
  };
}

function targetKey(targets: DiscoveryWatchTargets): string {
  return JSON.stringify([targets.files, targets.directories]);
}

function relativePattern(target: string, suffix = ''): GlobPattern {
  return {
    baseUri: URI.file(path.dirname(target)).toString(),
    pattern: `${escapeGlobLiteral(path.basename(target))}${suffix}`,
  };
}

function pollingSnapshot(target: string): fs.Stats | undefined {
  try {
    return fs.statSync(target, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

function pollingSnapshotChanged(current: fs.Stats | undefined, prior: fs.Stats | undefined): boolean {
  if (!current || !prior) return current !== prior;
  return current.mtimeMs !== prior.mtimeMs
    || current.ctimeMs !== prior.ctimeMs
    || current.size !== prior.size
    || current.ino !== prior.ino
    || current.nlink !== prior.nlink;
}

/** Build precise file patterns plus directory and immediate-child patterns. */
export function createWatchers(
  targets: DiscoveryWatchTargets,
  relativePatternSupport = false,
): FileSystemWatcher[] {
  const normalized = normalizeTargets(targets);
  if (relativePatternSupport) {
    return [
      ...normalized.files.map(file => ({ globPattern: relativePattern(file) })),
      ...normalized.directories.flatMap(directory => [
        { globPattern: relativePattern(directory) },
        { globPattern: relativePattern(directory, '/*') },
      ]),
    ];
  }

  return [
    ...normalized.files.map(file => ({ globPattern: globPath(file) })),
    ...normalized.directories.flatMap(directory => {
      const literal = globPath(directory);
      return [{ globPattern: literal }, { globPattern: `${literal}/*` }];
    }),
  ];
}

/**
 * Owns either one LSP dynamic registration or portable fs.watchFile pollers.
 * Call notifyChange from the server's onDidChangeWatchedFiles handler.
 */
export class WatchManager {
  private readonly registrationAdapter?: WatchRegistrationAdapter;
  private readonly debounceMs: number;
  private readonly pollingIntervalMs: number;
  private readonly onError?: (error: unknown) => void;
  private registration?: WatchRegistration;
  private pollingStops: Array<() => void> = [];
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private key?: string;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly onChange: () => void,
    options: WatchManagerOptions = {},
  ) {
    this.registrationAdapter = options.registrationAdapter;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.pollingIntervalMs = options.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;
    this.onError = options.onError;
  }

  /** Replace the watched targets. Equivalent normalized targets are a no-op. */
  update(targets: DiscoveryWatchTargets): Promise<void> {
    if (this.disposed) return Promise.resolve();

    const normalized = normalizeTargets(targets);
    const key = targetKey(normalized);
    if (key === this.key) return Promise.resolve();
    this.key = key;
    const generation = ++this.generation;

    return this.applyUpdate(normalized, generation).catch(error => this.reportError(error));
  }

  /** Debounce a change reported by the LSP client (or by a poller). */
  notifyChange(): void {
    if (this.disposed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (!this.disposed) this.onChange();
    }, this.debounceMs);
  }

  /** Stop registrations, pollers, and queued callbacks. Safe to call repeatedly. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    this.stopPolling();

    const registration = this.registration;
    this.registration = undefined;
    if (registration) await this.disposeRegistration(registration);
  }

  private async applyUpdate(targets: DiscoveryWatchTargets, generation: number): Promise<void> {
    const adapter = this.registrationAdapter;
    const watchers = createWatchers(targets, adapter?.relativePatternSupport);

    if (adapter && watchers.length > 0) {
      let next: WatchRegistration;
      try {
        next = await adapter.register({ watchers });
      } catch (error) {
        this.reportError(error);
        if (this.isCurrent(generation)) await this.usePolling(targets);
        return;
      }

      if (!this.isCurrent(generation)) {
        await this.disposeRegistration(next);
        return;
      }

      this.stopPolling();
      const previous = this.registration;
      this.registration = next;
      if (previous) await this.disposeRegistration(previous);
      return;
    }

    if (this.isCurrent(generation)) await this.usePolling(targets);
  }

  private async usePolling(targets: DiscoveryWatchTargets): Promise<void> {
    this.stopPolling();
    const previous = this.registration;
    this.registration = undefined;

    for (const target of [...targets.files, ...targets.directories]) {
      // Keep our own baseline: fs.watchFile establishes its initial stat
      // asynchronously and can treat a just-created target as the baseline.
      let prior = pollingSnapshot(target);
      const timer = setInterval(() => {
        const current = pollingSnapshot(target);
        if (pollingSnapshotChanged(current, prior)) this.notifyChange();
        prior = current;
      }, this.pollingIntervalMs);
      timer.unref();
      this.pollingStops.push(() => clearInterval(timer));
    }

    if (previous) await this.disposeRegistration(previous);
  }

  private stopPolling(): void {
    for (const stop of this.pollingStops.splice(0)) stop();
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private async disposeRegistration(registration: WatchRegistration): Promise<void> {
    try {
      await registration.dispose();
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    try {
      this.onError?.(error);
    } catch {
      // Error reporting must never create an unhandled rejection.
    }
  }
}

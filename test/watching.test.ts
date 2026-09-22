import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimatch } from 'minimatch';
import {
  createWatchers,
  escapeGlobLiteral,
  WatchManager,
  type WatchRegistration,
  type WatchRegistrationAdapter,
} from '../src/watching.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(name = 'watching'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for watcher');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('watch patterns', () => {
  it('uses bracket expressions for every glob metacharacter and POSIX backslash', () => {
    expect(escapeGlobLiteral('*?{}[]\\')).toBe('[*][?][{][}][[][]][\\\\]');
  });

  it('escapes metacharacters in absolute file and shallow directory globs', () => {
    const root = temporaryDirectory('glob-[literal]');
    const file = path.join(root, 'tokens{dark}?.json');
    const directory = path.join(root, 'node_modules[*]');

    const patterns = createWatchers({ files: [file], directories: [directory] })
      .map(watcher => watcher.globPattern);
    const escapedFile = escapeGlobLiteral(file.split(path.sep).join('/'));
    const escapedDirectory = escapeGlobLiteral(directory.split(path.sep).join('/'));

    expect(patterns).toEqual([
      escapedFile,
      escapedDirectory,
      `${escapedDirectory}/*`,
    ]);
    expect(patterns.every(pattern => typeof pattern === 'string')).toBe(true);
  });

  it('uses RelativePattern only when support is advertised', () => {
    const root = temporaryDirectory();
    const file = path.join(root, 'a[b].json');
    const [watcher] = createWatchers({ files: [file], directories: [] }, true);

    expect(watcher.globPattern).toEqual({
      baseUri: expect.stringMatching(/^file:/),
      pattern: 'a[[]b[]].json',
    });
  });

  it('matches literal metacharacters without wildcard expansion in absolute and relative patterns', () => {
    const root = temporaryDirectory();
    const cases = [
      ['star*.json', 'star-expanded.json'],
      ['question?.json', 'questionx.json'],
      ['open{.json', 'openx.json'],
      ['close}.json', 'closex.json'],
      ['left[.json', 'leftx.json'],
      ['right].json', 'rightx.json'],
      ...(process.platform === 'win32' ? [] : [['slash\\.json', 'slashx.json']]),
    ];

    for (const [literalName, expandedName] of cases) {
      const literalPath = path.join(root, literalName);
      const expandedPath = path.join(root, expandedName);
      const [absoluteWatcher] = createWatchers({ files: [literalPath], directories: [] });
      const [relativeWatcher] = createWatchers({ files: [literalPath], directories: [] }, true);
      const absolutePattern = absoluteWatcher.globPattern;
      const relativePattern = relativeWatcher.globPattern;

      expect(typeof absolutePattern).toBe('string');
      expect(typeof relativePattern).toBe('object');
      if (typeof absolutePattern !== 'string' || typeof relativePattern === 'string') {
        throw new Error('Unexpected watcher pattern kind');
      }

      expect(minimatch(literalPath, absolutePattern)).toBe(true);
      expect(minimatch(expandedPath, absolutePattern)).toBe(false);
      expect(minimatch(literalName, relativePattern.pattern)).toBe(true);
      expect(minimatch(expandedName, relativePattern.pattern)).toBe(false);
    }
  });
});

describe('WatchManager dynamic registration', () => {
  it('does not churn registrations for equivalent normalized targets', async () => {
    const root = temporaryDirectory();
    const register = vi.fn(async (): Promise<WatchRegistration> => ({ dispose: vi.fn() }));
    const manager = new WatchManager(vi.fn(), {
      registrationAdapter: { register },
    });

    await manager.update({
      files: [path.join(root, 'dir', '..', 'manifest.json')],
      directories: [path.join(root, 'node_modules'), path.join(root, 'node_modules')],
    });
    await manager.update({
      directories: [path.join(root, 'node_modules')],
      files: [path.join(root, 'manifest.json')],
    });

    expect(register).toHaveBeenCalledTimes(1);
    await manager.dispose();
  });

  it('disposes stale overlapping registrations without replacing the newest one', async () => {
    const first = deferred<WatchRegistration>();
    const second = deferred<WatchRegistration>();
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const register = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const manager = new WatchManager(vi.fn(), {
      registrationAdapter: { register },
    });
    const root = temporaryDirectory();

    const firstUpdate = manager.update({ files: [path.join(root, 'first')], directories: [] });
    const secondUpdate = manager.update({ files: [path.join(root, 'second')], directories: [] });
    second.resolve({ dispose: secondDispose });
    await secondUpdate;
    first.resolve({ dispose: firstDispose });
    await firstUpdate;

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).not.toHaveBeenCalled();
    await manager.dispose();
    expect(secondDispose).toHaveBeenCalledOnce();
  });

  it('replaces and disposes an older active registration', async () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const adapter: WatchRegistrationAdapter = {
      register: vi.fn()
        .mockResolvedValueOnce({ dispose: firstDispose })
        .mockResolvedValueOnce({ dispose: secondDispose }),
    };
    const manager = new WatchManager(vi.fn(), { registrationAdapter: adapter });
    const root = temporaryDirectory();

    await manager.update({ files: [path.join(root, 'one')], directories: [] });
    await manager.update({ files: [path.join(root, 'two')], directories: [] });

    expect(firstDispose).toHaveBeenCalledOnce();
    await manager.dispose();
    expect(secondDispose).toHaveBeenCalledOnce();
  });

  it('does not wait for a registration request that never resolves', async () => {
    const manager = new WatchManager(vi.fn(), {
      registrationAdapter: { register: () => new Promise<WatchRegistration>(() => undefined) },
    });
    const root = temporaryDirectory();

    void manager.update({ files: [path.join(root, 'pending')], directories: [] });
    const result = await Promise.race([
      manager.dispose().then(() => 'disposed'),
      new Promise<string>(resolve => setTimeout(() => resolve('timed out'), 100)),
    ]);

    expect(result).toBe('disposed');
  });

  it('disposes a pending registration when it resolves after disposal', async () => {
    const pending = deferred<WatchRegistration>();
    const disposeRegistration = vi.fn();
    const manager = new WatchManager(vi.fn(), {
      registrationAdapter: { register: () => pending.promise },
    });
    const root = temporaryDirectory();

    const update = manager.update({ files: [path.join(root, 'pending')], directories: [] });
    await manager.dispose();
    pending.resolve({ dispose: disposeRegistration });
    await update;

    expect(disposeRegistration).toHaveBeenCalledOnce();
  });

  it('cancels a debounced client notification on disposal', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const manager = new WatchManager(onChange, { debounceMs: 25 });

    manager.notifyChange();
    await manager.dispose();
    await vi.advanceTimersByTimeAsync(30);

    expect(onChange).not.toHaveBeenCalled();
    await manager.update({ files: ['/ignored'], directories: [] });
    manager.notifyChange();
    await vi.advanceTimersByTimeAsync(30);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('WatchManager polling fallback', () => {
  it('reliably observes files created immediately after repeated polling updates', async () => {
    vi.useFakeTimers();
    const root = temporaryDirectory();
    const onChange = vi.fn();
    const manager = new WatchManager(onChange, {
      pollingIntervalMs: 20,
      debounceMs: 5,
    });

    for (let iteration = 0; iteration < 10; iteration += 1) {
      const file = path.join(root, `immediate-${iteration}.json`);
      await manager.update({ files: [file], directories: [] });
      fs.writeFileSync(file, '{}');
      await vi.advanceTimersByTimeAsync(25);
      expect(onChange).toHaveBeenCalledTimes(iteration + 1);
    }

    await manager.dispose();
  });

  it('falls back after rejected registration and observes an absent file', async () => {
    const root = temporaryDirectory();
    const file = path.join(root, 'not-created-yet.json');
    const onChange = vi.fn();
    const onError = vi.fn();
    const manager = new WatchManager(onChange, {
      registrationAdapter: {
        register: async () => { throw new Error('client rejected registration'); },
      },
      pollingIntervalMs: 20,
      debounceMs: 5,
      onError,
    });

    await expect(manager.update({ files: [file], directories: [] })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    fs.writeFileSync(file, '{}');
    await waitFor(() => onChange.mock.calls.length > 0);

    await manager.dispose();
  });

  it('observes creation of an absent directory and stops after disposal', async () => {
    const root = temporaryDirectory();
    const nodeModules = path.join(root, 'node_modules');
    const onChange = vi.fn();
    const manager = new WatchManager(onChange, {
      pollingIntervalMs: 20,
      debounceMs: 5,
    });

    await manager.update({ files: [], directories: [nodeModules] });
    fs.mkdirSync(nodeModules);
    await waitFor(() => onChange.mock.calls.length > 0);
    await manager.dispose();

    const callsAtDisposal = onChange.mock.calls.length;
    fs.mkdirSync(path.join(nodeModules, 'new-package'));
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(onChange).toHaveBeenCalledTimes(callsAtDisposal);
  });
});

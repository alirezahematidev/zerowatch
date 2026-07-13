import type { AwaitWriteOptions, WatchOptions } from "../types/options.js";

/** Fully-resolved, defaulted options used internally by the watcher core. */
export interface ResolvedOptions {
  readonly recursive: boolean;
  readonly debounce: number;
  readonly batch: number;
  readonly gitignore: boolean;
  readonly awaitWrite: false | AwaitWriteOptions;
  readonly followSymlinks: boolean;
  readonly ignoreInitial: boolean;
  readonly cwd: string;
  /** Time window (ms) to pair delete+create into a move. */
  readonly moveWindow: number;
  /** Flush debounce/batch buffers on close instead of dropping them. */
  readonly flushOnClose: boolean;
  /** Use the polling backend instead of native fs.watch. */
  readonly usePolling: boolean;
  /** Poll interval (ms) for the polling backend. */
  readonly interval: number;
  readonly raw: WatchOptions;
}

/** Apply documented defaults to user-supplied options. */
export function resolveOptions(options: WatchOptions, cwd: string): ResolvedOptions {
  const awaitWrite =
    options.awaitWrite === true
      ? {}
      : options.awaitWrite === false || options.awaitWrite === undefined
        ? false
        : options.awaitWrite;

  return {
    recursive: options.recursive ?? true,
    debounce: Math.max(0, options.debounce ?? 0),
    batch: Math.max(0, options.batch ?? 0),
    gitignore: options.gitignore ?? false,
    awaitWrite,
    followSymlinks: options.followSymlinks ?? false,
    ignoreInitial: options.ignoreInitial ?? false,
    cwd: options.cwd ?? cwd,
    moveWindow: Math.max(0, options.moveWindow ?? 100),
    flushOnClose: options.flushOnClose ?? false,
    usePolling: options.usePolling ?? false,
    interval: Math.max(1, options.interval ?? 500),
    raw: options,
  };
}

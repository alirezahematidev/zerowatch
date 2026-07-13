import type { WatchEvent } from "./events.js";

/**
 * A user-supplied predicate deciding whether a path should be ignored.
 * Return `true` to ignore the entry (and, for directories, its descendants).
 */
export type IgnoreFunction = (
  absolutePath: string,
  relativePath: string,
) => boolean;

/**
 * Any accepted form of ignore rule: a glob string, a predicate, or an array of
 * either.
 */
export type IgnoreInput = string | IgnoreFunction | Array<string | IgnoreFunction>;

/**
 * Fine-grained control over write-stability detection. When enabled, `create`
 * and `change` events for files are held back until the file has stopped
 * growing, so that consumers never observe a partially written file.
 */
export interface AwaitWriteOptions {
  /** Milliseconds a file's size must remain unchanged before emitting. Default: `100`. */
  stabilityThreshold?: number;
  /** How often (ms) to poll the file size while waiting. Default: `50`. */
  pollInterval?: number;
}

/**
 * Options accepted by {@link watch}, {@link createWatcher} and friends.
 * Every field is optional; sensible defaults are documented per-field.
 */
export interface WatchOptions {
  /**
   * Watch directories recursively. Default: `true` for directories.
   * Ignored when watching a single file.
   */
  recursive?: boolean;
  /**
   * Patterns and/or predicates describing entries to ignore. Glob strings
   * support `*`, `**`, `?` and character classes and are matched against the
   * path relative to the watched root as well as the absolute path.
   */
  ignore?: IgnoreInput;
  /**
   * Only emit events for files whose extension is included. Extensions may be
   * written with or without a leading dot (`"ts"` and `".ts"` are equivalent).
   * Directory events are always allowed through so recursion still works.
   */
  extensions?: string[];
  /**
   * Coalesce rapid duplicate events for the same path+type that occur within
   * this many milliseconds into a single event. `0` / omitted disables it.
   */
  debounce?: number;
  /**
   * Collect events over a window of this many milliseconds and deliver them as
   * an array (`WatchEvent[]`) instead of one at a time. `0` / omitted disables
   * batching.
   */
  batch?: number;
  /**
   * Load `.gitignore` files (starting at the watched root) and honor their
   * rules. Default: `false`.
   */
  gitignore?: boolean;
  /**
   * Hold back `create`/`change` events for files until their size is stable,
   * so partially written files are never reported. Pass `true` for defaults or
   * an object to tune thresholds. Default: `false`.
   */
  awaitWrite?: boolean | AwaitWriteOptions;
  /**
   * Follow symbolic links when scanning and watching. Default: `false`.
   */
  followSymlinks?: boolean;
  /**
   * Suppress the synthetic `create` events normally emitted for entries that
   * already exist when watching starts. Default: `false`.
   */
  ignoreInitial?: boolean;
  /**
   * Base directory used to compute relative paths and to resolve relative
   * watch targets. Default: `process.cwd()`.
   */
  cwd?: string;
  /**
   * Time window (ms) within which a `delete` and a `create` sharing an inode are
   * paired into a single `move`. Larger values tolerate slower filesystems (e.g.
   * network mounts) at the cost of extra delete/create latency. Default: `100`.
   */
  moveWindow?: number;
  /**
   * When closing, flush events still held in the debounce/batch buffers instead
   * of dropping them. Speculative holds (pending move pairing / write-stability)
   * are always dropped on close. Default: `false`.
   */
  flushOnClose?: boolean;
  /**
   * Use a polling backend (periodic `fs.stat` scans) instead of native
   * `fs.watch`. Slower and more CPU-hungry, but reliable on network filesystems,
   * some Docker bind mounts, and other environments where `fs.watch` misfires.
   * Default: `false`.
   */
  usePolling?: boolean;
  /**
   * Poll interval (ms) for the polling backend. Only used when `usePolling` is
   * `true`. Default: `500`.
   */
  interval?: number;
  /**
   * A separate, usually slower poll interval (ms) for binary files, matched by
   * {@link WatchOptions.binaryExtensions}. Lets you poll large media/asset trees
   * less aggressively. Only used when `usePolling` is `true`. Default: same as
   * `interval`.
   */
  binaryInterval?: number;
  /**
   * File extensions treated as "binary" for {@link WatchOptions.binaryInterval}
   * (with or without a leading dot). Defaults to a built-in set of common media,
   * archive, and compiled-artifact extensions.
   */
  binaryExtensions?: string[];
  /**
   * Maximum recursion depth relative to each watched root. `0` watches only the
   * root's direct entries; omitted means unlimited.
   */
  depth?: number;
  /**
   * Bound the async-iterator buffer to this many pending events (or batches).
   * When a consumer cannot keep up, the oldest buffered items are dropped to cap
   * memory. `0` / omitted means unbounded. Listeners (`.on`) are unaffected.
   */
  maxBufferedEvents?: number;
  /**
   * Detect content edits that leave size, mtime, and ctime unchanged by hashing
   * file contents. Robust but costs an extra read per candidate event, so it is
   * opt-in. Default: `false`.
   */
  hashChanges?: boolean;
}

/** Options for {@link createWatcher}, which additionally accepts the target paths. */
export interface CreateWatcherOptions extends WatchOptions {
  /** One or more paths to watch. */
  paths: string | string[];
}

/**
 * The map of events a {@link Watcher} emits, keyed by event name. Used to
 * derive fully-typed `on`/`off` signatures.
 */
export interface WatcherEventMap {
  create: (event: WatchEvent) => void;
  change: (event: WatchEvent) => void;
  delete: (event: WatchEvent) => void;
  move: (event: WatchEvent) => void;
  /** Fires for every normalized event regardless of type. */
  all: (event: WatchEvent) => void;
  /** Fires once per batch window when `batch` is enabled. */
  batch: (events: WatchEvent[]) => void;
  /** A recoverable error occurred; the watcher keeps running. */
  error: (error: Error) => void;
  /** The initial scan has completed and the watcher is live. */
  ready: () => void;
  /** The watcher has been fully closed. */
  close: () => void;
}

export type WatcherEventName = keyof WatcherEventMap;

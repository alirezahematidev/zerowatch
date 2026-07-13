/**
 * Internal contracts shared between the platform layer and the watcher core.
 * These are not part of the public API.
 */

/** The kind of raw notification a native watcher can produce. */
export type RawEventKind = "rename" | "change";

/**
 * A raw, un-normalized filesystem notification emitted by a platform adapter.
 * The core is responsible for turning a stream of these into {@link WatchEvent}s.
 */
export interface RawFsEvent {
  /** What the OS told us happened. */
  readonly kind: RawEventKind;
  /** Absolute path the notification concerns. */
  readonly absolutePath: string;
}

/** Callbacks a platform adapter uses to report activity back to the core. */
export interface PlatformSink {
  onEvent(event: RawFsEvent): void;
  onError(error: Error): void;
}

/**
 * A platform-specific watcher. Adapters normalize `fs.watch` quirks (recursive
 * support, event coalescing) behind this uniform surface. No public API type
 * depends on this.
 */
export interface PlatformWatcher {
  /** Begin watching. Safe to call once. */
  start(): Promise<void>;
  /** Stop watching and release all native handles. Idempotent. */
  close(): Promise<void>;
}

/** Options handed to a platform adapter after defaults are applied. */
export interface PlatformWatchTarget {
  /** Absolute path to watch. */
  readonly absolutePath: string;
  /** Whether the target is a directory (vs a single file). */
  readonly isDirectory: boolean;
  /** Recurse into subdirectories (directories only). */
  readonly recursive: boolean;
  /** Follow symbolic links while walking directories. */
  readonly followSymlinks: boolean;
}

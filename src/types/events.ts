/**
 * The normalized set of filesystem event types emitted by zerowatch.
 *
 * All platform-specific native events are reduced to exactly these four kinds.
 *
 * - `create` — a new file or directory appeared.
 * - `change` — an existing file's contents changed.
 * - `delete` — a file or directory was removed.
 * - `move` — an entry was renamed/moved; see {@link WatchEvent.oldPath}.
 */
export type WatchEventType = "create" | "change" | "delete" | "move";

/**
 * A single normalized filesystem event.
 *
 * `path`, `absolutePath` and `relativePath` all point at the *current* location
 * of the entry. For `move` events that means the destination; the origin is
 * available on {@link WatchEvent.oldPath}.
 *
 * @example
 * ```ts
 * watcher.on("all", (event: WatchEvent) => {
 *   if (event.type === "move") {
 *     console.log(`moved ${event.oldPath} -> ${event.absolutePath}`);
 *   } else {
 *     console.log(`${event.type}: ${event.relativePath}`);
 *   }
 * });
 * ```
 */
export interface WatchEvent {
  /** The normalized kind of change. */
  readonly type: WatchEventType;
  /**
   * The path as it relates to the watched root — identical to
   * {@link WatchEvent.relativePath}. Kept for ergonomic access.
   */
  readonly path: string;
  /** Fully resolved absolute path of the entry. */
  readonly absolutePath: string;
  /** Path relative to the watched root. */
  readonly relativePath: string;
  /** Milliseconds since the Unix epoch when the event was produced. */
  readonly timestamp: number;
  /**
   * Only present on `move` events: the previous absolute path the entry was
   * moved from. Undefined for every other event type.
   */
  readonly oldPath?: string;
  /**
   * True when the entry is a directory (best-effort; may be undefined when the
   * entry no longer exists, e.g. on `delete`).
   */
  readonly isDirectory?: boolean;
}

/**
 * An error surfaced by a watcher. Watchers never throw asynchronously and never
 * crash the process on recoverable errors (e.g. `EACCES`, `EPERM`); instead the
 * error is delivered through the `error` event.
 */
export interface WatchError extends Error {
  /** The underlying errno code when available (e.g. `EACCES`). */
  readonly code?: string;
  /** The path the error is associated with, when known. */
  readonly path?: string;
}

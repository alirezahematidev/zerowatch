import type { WatchEvent } from "./types/events.js";
import type { CreateWatcherOptions, WatchOptions } from "./types/options.js";
import { Watcher, type EmittedUnit } from "./core/watcher.js";

/** Options that enable batching, used to widen the return type to arrays. */
type BatchedOptions = WatchOptions & { batch: number };

/**
 * The `watch` entry point, callable directly and also carrying `file` and
 * `directory` convenience variants. When `batch` is set the returned watcher
 * yields `WatchEvent[]`; otherwise it yields single `WatchEvent`s.
 */
export interface WatchFunction {
  (path: string | string[], options: BatchedOptions): Watcher<WatchEvent[]>;
  (path: string | string[], options?: WatchOptions): Watcher<WatchEvent>;

  /** Watch a single file for `change`/`delete` (and `create` if it appears). */
  file(path: string, options: BatchedOptions): Watcher<WatchEvent[]>;
  file(path: string, options?: WatchOptions): Watcher<WatchEvent>;

  /** Watch a directory (recursive by default). */
  directory(path: string, options: BatchedOptions): Watcher<WatchEvent[]>;
  directory(path: string, options?: WatchOptions): Watcher<WatchEvent>;
}

function makeWatcher(
  paths: string | string[],
  options: WatchOptions,
): Watcher<EmittedUnit> {
  return new Watcher(paths, options) as Watcher<EmittedUnit>;
}

const watchImpl = ((paths: string | string[], options: WatchOptions = {}) =>
  makeWatcher(paths, options)) as WatchFunction;

watchImpl.file = ((filePath: string, options: WatchOptions = {}) =>
  // A single file is never recursive.
  makeWatcher(filePath, { ...options, recursive: false })) as WatchFunction["file"];

watchImpl.directory = ((dirPath: string, options: WatchOptions = {}) =>
  makeWatcher(dirPath, { recursive: true, ...options })) as WatchFunction["directory"];

/**
 * Watch one or more paths and receive normalized filesystem events.
 *
 * @example
 * ```ts
 * for await (const event of watch("src")) {
 *   console.log(event.type, event.relativePath);
 * }
 * ```
 */
export const watch: WatchFunction = watchImpl;

/**
 * Explicit factory equivalent to {@link watch}, taking the target paths inside
 * the options object. Handy when options are assembled programmatically.
 */
export function createWatcher(
  options: CreateWatcherOptions & { batch: number },
): Watcher<WatchEvent[]>;
export function createWatcher(options: CreateWatcherOptions): Watcher<WatchEvent>;
export function createWatcher(options: CreateWatcherOptions): Watcher<EmittedUnit> {
  const { paths, ...rest } = options;
  return makeWatcher(paths, rest);
}

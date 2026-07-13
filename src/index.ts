/**
 * watchx — a modern, ESM-first, zero-dependency file watcher for Node.js.
 *
 * @packageDocumentation
 */
export { watch, createWatcher, type WatchFunction } from "./api.js";
export { Watcher, type EmittedUnit } from "./core/watcher.js";

export type {
  WatchEvent,
  WatchEventType,
  WatchError,
  WatchOptions,
  CreateWatcherOptions,
  AwaitWriteOptions,
  IgnoreInput,
  IgnoreFunction,
  WatcherEventMap,
  WatcherEventName,
} from "./types/index.js";

export {
  nativeRecursiveSupported,
  inodeMoveDetectionSupported,
} from "./platform/capabilities.js";

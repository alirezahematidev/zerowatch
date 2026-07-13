# API Reference

All exports are named and tree-shakable.

```ts
import {
  watch,
  createWatcher,
  Watcher,
  nativeRecursiveSupported,
  inodeMoveDetectionSupported,
  type WatchEvent,
  type WatchOptions,
} from "zerowatch";
```

---

## `watch(path, options?)`

The primary entry point.

```ts
function watch(path: string | string[], options?: WatchOptions): Watcher<WatchEvent>;
function watch(path: string | string[], options: WatchOptions & { batch: number }): Watcher<WatchEvent[]>;
```

- `path` — a path or array of paths (files or directories). Relative paths resolve against `options.cwd`.
- Returns a [`Watcher`](#class-watcher). When `options.batch` is set the watcher yields `WatchEvent[]`; otherwise single `WatchEvent`s.

### `watch.file(path, options?)`

Watch a single file. Recursion is forced off. Emits `change`/`delete` (and `create` if the file is (re)created).

### `watch.directory(path, options?)`

Watch a directory. Recursive by default.

---

## `createWatcher(options)`

Explicit factory that takes target paths inside the options object.

```ts
function createWatcher(options: CreateWatcherOptions): Watcher<WatchEvent>;
function createWatcher(options: CreateWatcherOptions & { batch: number }): Watcher<WatchEvent[]>;

interface CreateWatcherOptions extends WatchOptions {
  paths: string | string[];
}
```

---

## `WatchOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `recursive` | `boolean` | `true` | Recurse into subdirectories (directory targets only). |
| `ignore` | `string \| IgnoreFunction \| Array<string \| IgnoreFunction>` | — | Glob patterns and/or predicates to ignore. |
| `extensions` | `string[]` | — | Allow-list of file extensions (with or without leading dot). |
| `debounce` | `number` | `0` | Coalesce duplicate `(type, path)` events within this many ms. |
| `batch` | `number` | `0` | Deliver `WatchEvent[]` per window of this many ms. |
| `gitignore` | `boolean` | `false` | Honor `.gitignore` files (root and nested). |
| `awaitWrite` | `boolean \| AwaitWriteOptions` | `false` | Hold `create`/`change` until file size is stable. |
| `followSymlinks` | `boolean` | `false` | Follow symlinks while scanning/watching. |
| `ignoreInitial` | `boolean` | `false` | Suppress synthetic `create` events for pre-existing entries. |
| `cwd` | `string` | `process.cwd()` | Base directory for relative paths. |

### `AwaitWriteOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `stabilityThreshold` | `number` | `100` | Ms a file's size must stay unchanged before emitting. |
| `pollInterval` | `number` | `50` | How often (ms) the size is polled while waiting. |

### `IgnoreFunction`

```ts
type IgnoreFunction = (absolutePath: string, relativePath: string) => boolean;
```

Return `true` to ignore the entry. For directories, returning `true` also prevents descending into them.

---

## `WatchEvent`

```ts
interface WatchEvent {
  type: "create" | "change" | "delete" | "move";
  path: string;          // alias of relativePath
  absolutePath: string;
  relativePath: string;  // POSIX separators, relative to the watched root
  timestamp: number;
  oldPath?: string;      // move only: previous absolute path
  isDirectory?: boolean; // best-effort
}
```

Ignore-glob matching runs against `relativePath` (POSIX) and `absolutePath`.

---

## Class `Watcher<T>`

`T` is the async-iterator element type: `WatchEvent` normally, `WatchEvent[]` when batching. Construct via `watch`/`createWatcher`, or directly:

```ts
new Watcher(paths: string | string[], options?: WatchOptions);
```

### `watcher.ready(): Promise<void>`

Resolves once the initial directory scan is complete and live watching has begun. Rejects only on a hard startup failure.

### `watcher.close(): Promise<void>`

Stops watching, releases all native handles, and terminates the async iterator. Idempotent.

### `watcher.on(event, listener)` / `once` / `off`

Fully typed. Events:

| Event | Listener | Fires |
| --- | --- | --- |
| `create` | `(e: WatchEvent) => void` | Entry created. |
| `change` | `(e: WatchEvent) => void` | File content changed. |
| `delete` | `(e: WatchEvent) => void` | Entry removed. |
| `move` | `(e: WatchEvent) => void` | Entry renamed/moved (has `oldPath`). |
| `all` | `(e: WatchEvent) => void` | Every event, regardless of type. |
| `batch` | `(events: WatchEvent[]) => void` | Once per batch window (when `batch` is set). |
| `error` | `(err: Error) => void` | Recoverable error; watcher keeps running. |
| `ready` | `() => void` | Initial scan complete. |
| `close` | `() => void` | Watcher fully closed. |

> Typed events (`on("change")`) always fire per **single** event, even when batching. Batching only affects what the async iterator and the `batch` event deliver.

### `watcher.pause()` / `watcher.resume()`

`pause()` stops delivery; events that occur while paused are **buffered**. `resume()` flushes them in order. `watcher.paused` reflects the current state.

### `watcher[Symbol.asyncIterator]()`

Enables `for await (const event of watcher)`. Breaking out of the loop (or `return()`) closes the underlying stream.

---

## Capability flags

```ts
import { nativeRecursiveSupported, inodeMoveDetectionSupported } from "zerowatch";
```

- `nativeRecursiveSupported` — `true` on macOS/Windows, `false` on Linux (per-directory fallback).
- `inodeMoveDetectionSupported` — `true` where inode-based `move` detection is reliable (`false` on Windows).

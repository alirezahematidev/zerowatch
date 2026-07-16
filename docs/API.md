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

### Glob watch targets

`watch()` and `watch.directory()` accept **glob** targets — a target string
containing `*`, `?`, `[…]`, or `{…}`. The watcher watches the glob's static base
directory recursively and emits events only for **files** whose path matches the
glob:

```ts
watch("src/**/*.ts");                 // only .ts under src, at any depth
watch(["assets/**/*.png", "src/**/*.{ts,tsx}"]);
```

Directory events still fire and the tree is still traversed in full (needed to
find deep matches) — consistent with the `extensions` allow-list. `ignore`,
`gitignore`, `extensions`, and `depth` all still apply on top. `watch.file()`
always forces non-recursive watching and resolves its argument through the same
target logic as `watch()` — pass it a literal path; a string containing glob
metacharacters is still glob-matched (scoped non-recursively to its base
directory) rather than treated as a literal filename.

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
| `ignore` | `string \| IgnoreFunction \| Array<string \| IgnoreFunction>` | — | Glob patterns and/or predicates to ignore. Globs match case-insensitively on macOS/Windows, case-sensitively on Linux (see below). |
| `extensions` | `string[]` | — | Allow-list of file extensions (with or without leading dot). |
| `debounce` | `number` | `0` | Coalesce duplicate `(type, path)` events within this many ms. |
| `batch` | `number` | `0` | Deliver `WatchEvent[]` per window of this many ms. |
| `gitignore` | `boolean` | `false` | Honor `.gitignore` files (root and nested). |
| `ignoreHidden` | `boolean` | `false` | Ignore dotfiles/dot-folders (`.git`, `.env`, …) at any depth, pruning their subtrees. |
| `awaitWrite` | `boolean \| AwaitWriteOptions` | `false` | Hold `create`/`change` until file size is stable. |
| `followSymlinks` | `boolean` | `false` | Follow symlinks while scanning/watching. |
| `ignoreInitial` | `boolean` | `false` | Suppress synthetic `create` events for pre-existing entries. |
| `cwd` | `string` | `process.cwd()` | Base directory for relative paths. |
| `moveWindow` | `number` | `100` | Window (ms) to pair a `delete`+`create` sharing a `dev:ino` identity into a `move`. |
| `flushOnClose` | `boolean` | `false` | On `close()`, flush debounce/batch buffers instead of dropping them. |
| `usePolling` | `boolean` | `false` | Use periodic `stat` scans instead of native `fs.watch`. Keeps the process alive like the native backend. |
| `interval` | `number` | `500` | Poll interval (ms) when `usePolling` is set. |
| `binaryInterval` | `number` | `interval` | Separate, usually slower poll interval (ms) for binary files. |
| `binaryExtensions` | `string[]` | built-in set | Extensions treated as "binary" for `binaryInterval`. |
| `depth` | `number` | `∞` | Max recursion depth relative to each root (`0` = direct entries only). |
| `maxBufferedEvents` | `number` | `0` | Bound the async-iterator buffer (or batches); oldest dropped when exceeded. `0` = unbounded. |
| `hashChanges` | `boolean` | `false` | Detect edits that leave size/mtime/ctime unchanged by hashing contents. |

> **Numeric options are validated.** A non-finite value (`NaN`, `Infinity`) — e.g. from JSON/env parsing — falls back to the documented default instead of spinning the poll loop or silently dropping every event.

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

### Ignore matching

- **Case sensitivity.** Glob patterns (and `.gitignore` rules) match
  case-insensitively on case-insensitive filesystems (macOS APFS/HFS+, Windows
  NTFS) and case-sensitively on Linux — consistent with the OS and with the
  always-case-insensitive `extensions` allow-list. Predicate functions receive
  the raw path and decide for themselves.
- **Safety.** Glob compilation collapses redundant `**`/`*` runs so no pattern
  can trigger catastrophic regex backtracking, and a malformed pattern falls
  back to a literal match rather than throwing.

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
  stats?: Stats;         // fs.Stats; create/change only (incl. initial scan;
                         // settled under awaitWrite); absent on delete/move
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

> **Resource cleanup:** Always call `close()` when you are done with a watcher —
> it releases native `fs.watch` handles and ends the async iterator. As a
> backstop, a `Watcher` dropped without `close()` will have its handles closed
> when it is eventually garbage-collected, but finalizers are **not guaranteed
> to run** (and may run arbitrarily late), so explicit `close()` remains
> required for deterministic cleanup.

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
| `drop` | `(info: { count: number }) => void` | An event was dropped from the bounded async-iterator buffer (`maxBufferedEvents`); `count` is cumulative. |
| `error` | `(err: Error) => void` | Recoverable error; watcher keeps running. |
| `ready` | `() => void` | Initial scan complete. |
| `close` | `() => void` | Watcher fully closed. |

> Typed events (`on("change")`) always fire per **single** event, even when batching. Batching only affects what the async iterator and the `batch` event deliver.

### `watcher.pause()` / `watcher.resume()`

`pause()` stops delivery; events that occur while paused are **buffered**. `resume()` flushes them in order. `watcher.paused` reflects the current state.

### `watcher.add(paths): Promise<void>`

Begin watching one or more additional paths (including globs) on a live watcher.
Resolves once attached and pre-existing entries are seeded (initial `create`s
emitted unless `ignoreInitial` is set). No-op for already-watched paths or after
`close()`.

### `watcher.unwatch(paths): Promise<void>`

Stop watching one or more paths, releasing their handles and forgetting their
tracked entries. No `delete` events are emitted for the forgotten subtree.

### `watcher.getWatched(): Record<string, string[]>`

The currently tracked entries, grouped by parent directory (relative to the
watched root, `"."` for the root's own children) mapping to sorted child
basenames — the same shape chokidar returns.

### `watcher[Symbol.asyncIterator]()`

Enables `for await (const event of watcher)`. Breaking out of the loop (or `return()`) closes the underlying stream.

---

## Capability flags

```ts
import { nativeRecursiveSupported, inodeMoveDetectionSupported } from "zerowatch";
```

- `nativeRecursiveSupported` — `true` on macOS/Windows, `false` on Linux (per-directory fallback).
- `inodeMoveDetectionSupported` — `true` where inode-based `move` detection is reliable (`false` on Windows).

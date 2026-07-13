# watchx

> A modern, dual **ESM/CommonJS**, zero-dependency file watcher for Node.js — a spiritual successor to [chokidar](https://github.com/paulmillr/chokidar).

`watchx` gives you filesystem watching with the ergonomics you'd design today: **async iterators** as the primary API, **promises** for lifecycle, **typed events**, and a **normalized four-event model** (`create` / `change` / `delete` / `move`) across Linux, macOS and Windows.

```ts
import { watch } from "watchx";

for await (const event of watch("src")) {
  console.log(event.type, event.relativePath);
}
```

## Features

- 🧭 **Async-iterator first** — `for await (const event of watcher)` is the primary API.
- 🎯 **Normalized events** — every platform reduced to `create`, `change`, `delete`, `move`.
- 🧬 **Move detection** — renames are reported as a single `move` (with inode pairing), with graceful fallback to `delete`+`create` where unavailable.
- 📦 **Zero runtime dependencies** — nothing but Node's standard library.
- 🌳 **Tree-shakable & fully typed** — ESM, `"sideEffects": false`, no `any`, no `@ts-ignore`.
- 🔁 **ESM *and* CommonJS** — ships dual builds; use `import` or `require` on any of Linux, macOS, and Windows.
- 🧰 **Batteries included** — glob/function/`.gitignore` ignoring, extension filters, debounce, batching, write-stability (`awaitWrite`), symlink control.
- 🛡️ **Never crashes** — permission errors surface via the `error` event; the watcher keeps running.
- ⚡ **Fast startup** — native recursive watching on macOS/Windows; efficient per-directory fallback on Linux. ~2.6× faster cold start than chokidar over a 5k-file tree (see [`bench/`](bench/)).

Requires **Node.js ≥ 20**.

## Module systems

watchx ships both an ES-module and a CommonJS build, selected automatically via
the package `exports` map:

```js
// ESM / TypeScript
import { watch } from "watchx";

// CommonJS
const { watch } = require("watchx");
```

## Install

```sh
npm install watchx
```

## Quick start

### Async iterator (primary API)

```ts
import { watch } from "watchx";

const watcher = watch("src", { recursive: true });

for await (const event of watcher) {
  console.log(`${event.type}: ${event.relativePath}`);
}
```

### Typed events

```ts
import { watch } from "watchx";

const watcher = watch("src");

watcher.on("create", (e) => console.log("created", e.relativePath));
watcher.on("change", (e) => console.log("changed", e.relativePath));
watcher.on("delete", (e) => console.log("deleted", e.relativePath));
watcher.on("move", (e) => console.log("moved", e.oldPath, "→", e.absolutePath));
watcher.on("error", (err) => console.error("watch error", err));

await watcher.ready();
// ... later
await watcher.close();
```

### Promises & lifecycle

```ts
const watcher = watch("src");
await watcher.ready();   // resolves after the initial scan completes
watcher.pause();          // buffer events
watcher.resume();         // flush buffered events
await watcher.close();    // release all handles, end the iterator
```

## The event model

Every native event is normalized into exactly one of four types:

```ts
interface WatchEvent {
  type: "create" | "change" | "delete" | "move";
  path: string;          // same as relativePath (ergonomic alias)
  absolutePath: string;  // fully resolved path
  relativePath: string;  // relative to the watched root (POSIX separators)
  timestamp: number;     // Date.now() when the event was produced
  oldPath?: string;      // only on `move`: the previous absolute path
  isDirectory?: boolean; // best-effort; may be undefined on `delete`
}
```

**Move detection** pairs a `delete` and a `create` sharing an inode within a short window (default 100 ms). On platforms where inodes aren't reliable (Windows), or when the pair can't be correlated, `watchx` gracefully falls back to emitting separate `delete` and `create` events. Check `inodeMoveDetectionSupported` to know which mode you're in.

## Options

```ts
watch("src", {
  recursive: true,          // recurse into subdirectories (default: true for dirs)
  ignore: [                 // glob strings and/or predicate functions
    "**/*.log",
    "**/dist/**",
    "node_modules",         // a bare name prunes the whole subtree (all OSes)
    (abs, rel) => rel.startsWith("."),
  ],
  extensions: [".ts", ".tsx"], // allow-list; other files are ignored
  debounce: 100,            // collapse rapid duplicate events (ms)
  batch: 200,               // deliver WatchEvent[] per window (ms)
  gitignore: true,          // honor .gitignore files
  awaitWrite: true,         // wait until files stop being written before emitting
  followSymlinks: false,    // follow symlinks while scanning/watching (cycle-safe)
  ignoreInitial: false,     // suppress synthetic creates for existing entries
  cwd: process.cwd(),       // base for relative paths
  moveWindow: 100,          // ms to pair a delete+create into a move
  flushOnClose: false,      // on close, flush buffered (debounce/batch) events
  usePolling: false,        // use periodic stat scans instead of native fs.watch
  interval: 500,            // poll interval (ms) when usePolling is true
});
```

See [docs/API.md](docs/API.md) for the full reference.

### Dynamic watching

Add or remove targets on a live watcher, and inspect what's currently tracked:

```ts
const watcher = watch("src");
await watcher.ready();

await watcher.add("test");        // start watching another path
await watcher.unwatch("src/vendor"); // stop watching a subtree
watcher.getWatched();             // { "src": ["index.ts", ...], ... }
```

### Polling (network filesystems)

Native `fs.watch` can misfire on NFS/SMB mounts, some Docker bind mounts, and
virtualized filesystems. Switch to the polling backend when reliability matters
more than latency:

```ts
watch("/mnt/nfs/project", { usePolling: true, interval: 300 });
```

### Batching changes the iterator type

When `batch` is set, the watcher yields **arrays**:

```ts
for await (const events of watch("src", { batch: 200 })) {
  //          ^? WatchEvent[]
  console.log(`batch of ${events.length}`);
}
```

Without `batch`, it yields single `WatchEvent`s. The types reflect this automatically.

### Write stability (`awaitWrite`)

Large or slowly-written files can fire many intermediate events. With `awaitWrite`, `watchx` holds back `create`/`change` events until a file's **size and mtime** have both been stable for a threshold (so even a same-length rewrite is caught):

```ts
watch("uploads", {
  awaitWrite: { stabilityThreshold: 200, pollInterval: 50 },
});
```

## Convenience entry points

```ts
import { watch, createWatcher } from "watchx";

watch("src");                       // auto-detects file vs directory
watch.file("config.json");          // watch a single file
watch.directory("src");             // watch a directory (recursive by default)
createWatcher({ paths: ["src", "test"], gitignore: true }); // explicit factory
```

## Error handling

`watchx` never throws asynchronously and never crashes the process on recoverable errors (`EACCES`, `EPERM`, races). They surface through the `error` event; the watcher continues:

```ts
watch("/restricted").on("error", (err) => {
  console.warn("skipping:", err.message);
});
```

## Platform notes

| Platform | Recursive strategy | Move detection |
| --- | --- | --- |
| macOS | Native (`fs.watch` recursive / FSEvents) | inode pairing |
| Windows | Native (`ReadDirectoryChangesW`) | falls back to delete+create |
| Linux | One watcher per directory (auto-managed) | inode pairing |

## Benchmarks

Measured over a 5,000-file / 50-directory tree ([`bench/index.ts`](bench/index.ts), macOS). Run `yarn bench` to reproduce; if `chokidar` is installed it's compared side by side.

| | watchx | chokidar |
| --- | --- | --- |
| Cold startup (`ready` over 5k files) | **~67 ms** | ~175 ms |
| Runtime dependencies | **0** | `readdirp` |
| Bundle size (per format, minified) | **~19 KB** | — |

Cold start is ~2.6× faster and the install footprint is dependency-free. Sustained
per-event throughput is competitive but currently trails chokidar; see
[TODOS.md](TODOS.md) for the planned async-classification work.

## Documentation

- [API reference](docs/API.md)
- [Migration guide from chokidar](docs/MIGRATION.md)
- [Examples](examples/)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

MIT

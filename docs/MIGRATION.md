# Migrating from chokidar

`zerowatch` is not a drop-in replacement — it deliberately offers a modern API. This guide maps common chokidar patterns to their `zerowatch` equivalents.

## Creating a watcher

**chokidar**

```js
const chokidar = require("chokidar");
const watcher = chokidar.watch("src", { ignoreInitial: true });
```

**zerowatch**

```ts
import { watch } from "zerowatch";
const watcher = watch("src", { ignoreInitial: true });
```

## Events

chokidar emits `add`, `change`, `unlink`, `addDir`, `unlinkDir` (and `all`). `zerowatch` normalizes everything to four types, and distinguishes files vs directories via `event.isDirectory`.

| chokidar | zerowatch |
| --- | --- |
| `add` | `create` (file) |
| `addDir` | `create` (`isDirectory: true`) |
| `change` | `change` |
| `unlink` | `delete` (file) |
| `unlinkDir` | `delete` (`isDirectory: true`) |
| *(none — reported as unlink+add)* | `move` (with `oldPath`) |
| `all` | `all` |
| `ready` | `ready` event / `await watcher.ready()` |
| `error` | `error` |

**chokidar**

```js
watcher
  .on("add", (path) => {})
  .on("change", (path) => {})
  .on("unlink", (path) => {});
```

**zerowatch**

```ts
watcher
  .on("create", (e) => e.absolutePath)
  .on("change", (e) => e.absolutePath)
  .on("delete", (e) => e.absolutePath);
```

Note listeners now receive a rich `WatchEvent` object rather than a bare path string.

## Waiting for the initial scan

**chokidar**

```js
watcher.on("ready", () => console.log("ready"));
```

**zerowatch**

```ts
await watcher.ready();
console.log("ready");
```

## Consuming events as a stream

`zerowatch`'s headline feature — no analog in chokidar:

```ts
for await (const event of watch("src")) {
  console.log(event.type, event.relativePath);
}
```

## Options mapping

| chokidar | zerowatch |
| --- | --- |
| `ignored` | `ignore` (globs **and/or** predicate functions) |
| `ignoreInitial` | `ignoreInitial` |
| `followSymlinks` | `followSymlinks` |
| `cwd` | `cwd` |
| `depth` | *(use `recursive: false` for depth 0; arbitrary depth capping is not exposed)* |
| `awaitWriteFinish` | `awaitWrite` (`{ stabilityThreshold, pollInterval }`) |
| `usePolling` / `interval` | *(not needed; native watching + per-dir fallback)* |
| *(n/a)* | `debounce` |
| *(n/a)* | `batch` |
| *(n/a)* | `gitignore` |
| *(n/a)* | `extensions` |

### `ignored`

chokidar accepts globs, regexes and functions. `zerowatch` accepts glob strings and predicate functions:

**chokidar**

```js
chokidar.watch("src", { ignored: /(^|[/\\])\../ }); // dotfiles
```

**zerowatch**

```ts
watch("src", { ignore: (_abs, rel) => rel.split("/").some((s) => s.startsWith(".")) });
```

### `awaitWriteFinish`

**chokidar**

```js
chokidar.watch("up", { awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } });
```

**zerowatch**

```ts
watch("up", { awaitWrite: { stabilityThreshold: 200, pollInterval: 50 } });
```

## Closing

**chokidar**

```js
await watcher.close();
```

**zerowatch** — identical:

```ts
await watcher.close();
```

## Things that are intentionally different

- **No `getWatched()`** — inspect via your own `all` listener state.
- **No polling mode** — `zerowatch` relies on native `fs.watch`; Linux uses one handle per directory.
- **Paths are objects, not strings** — every callback receives a `WatchEvent`.
- **Batching & debouncing are first-class** — no need for userland wrappers.

# Benchmarks

Startup and throughput benchmarks for `zerowatch`, driven by
[tinybench](https://github.com/tinylibs/tinybench) for warmup, multiple samples,
and variance.

```sh
yarn bench            # builds, then runs node bench/index.ts
# or, after a build:
node bench/index.ts
```

## Comparing against other watchers

None of the compared libraries are dependencies of `zerowatch`. Each is
benchmarked **only if it is installed locally**; otherwise it is silently
skipped. To include one, install it as a dev dependency and re-run:

```sh
yarn add -D chokidar @parcel/watcher watchpack sane
yarn bench
```

| Watcher | Package | Notes |
| --- | --- | --- |
| zerowatch | (this repo) | Always run. |
| chokidar | `chokidar` | Always run when installed. |
| @parcel/watcher | `@parcel/watcher` | Native backend differs per OS (FSEvents / inotify / ReadDirectoryChangesW); cross-OS numbers are not directly comparable. |
| watchpack | `watchpack` | webpack's watcher; has no reliable "ready" event, so its startup number reflects only `watch()` setup, not a full initial scan. |
| sane | `sane` | Node-based fallback watcher. |
| node:fs.watch (raw) | built-in | Always run. Establishes a single recursive handle with no initial scan, so its "startup" is near-instant and not comparable to watchers that seed a snapshot. `{ recursive: true }` is **not supported on Linux**, so throughput is under-reported there. |

### Not benchmarked

`nodemon` / `node-dev` are process runners built on top of `chokidar`, not
embeddable watch APIs — benchmarking them would just re-measure `chokidar`, so
they are intentionally excluded.

## Scenarios

- **Startup** — cold time to `ready` over a 5,000-file tree (50 dirs).
- **Throughput** — time to deliver 1,000 events after editing 1,000 distinct files.

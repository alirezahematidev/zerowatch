# watchx — TODOs & Improvement Backlog

Tracks known limitations, latent bugs worth addressing, and future features.

---

## ✅ Done

### Hardening pass (2026-07-14)

- **Cross-OS ignore consistency** — descendants of an ignored directory are now
  suppressed on macOS/Windows too (ancestor-aware `#ancestorIgnored`, memoized).
- **CommonJS + ESM** — dual build via the `exports` map; `import` and `require`
  both work.
- **Bundled with tsup** — minified output (~19 KB/format, down from ~124 KB).
- Fixed: close-during-startup race, unhandled `ready()` rejection, false same-path
  `move`, `off()` not removing a pending `once()`, Windows path normalization.

### Feature/robustness pass (2026-07-14)

- **`getWatched()` / `add()` / `unwatch()`** — live watcher management.
- **Polling backend** (`usePolling`, `interval`) for network filesystems.
- **`moveWindow`** is now configurable; **`flushOnClose`** drains buffered
  debounce/batch events on close (dead `flush()` on the move detector removed).
- **Directory-move child pairing** — cascade deletes carry real inodes, so moved
  subtree contents can pair into `move`s (bounded by `moveWindow`).
- **Sharper change detection** — compares `ctime` as well as size/mtime, catching
  same-size same-millisecond edits.
- **`awaitWrite`** settles on size **and** mtime (catches same-length rewrites).
- **Symlink-cycle protection** — the scanner tracks real dev:inode and walks each
  directory at most once.
- **Nested brace-expansion** in ignore globs (`{a,{b,c}}`).
- **Emitter** skips the snapshot allocation for the common single-listener case.
- **Tooling** — GitHub Actions CI (Linux/macOS/Windows × Node 20/22), V8 coverage,
  release-it + conventional-changelog, CONTRIBUTING.md.

---

## ⚡ Performance — throughput vs chokidar

**Where:** [src/core/classifier.ts](src/core/classifier.ts), [src/core/watcher.ts](src/core/watcher.ts)

Cold-start is ~2.6× faster than chokidar, but sustained event **throughput** on
the macOS micro-benchmark trails (~11k vs ~16k ev/s). The classifier calls
`fs.lstatSync` synchronously per event for ordering determinism, which serializes
draining of the OS event queue.

- **Idea:** an async classification stage (batched `fs.stat` via a small bounded
  pool) that preserves per-path ordering. Non-trivial — must not reorder events
  for the same path — so gate behind benchmarks and thorough tests. **Deferred**
  as the highest-risk change; everything else in the backlog shipped first.

---

## ✨ Features (remaining)

- **Backpressure on the async iterator** — [src/core/async-queue.ts](src/core/async-queue.ts)
  buffers without bound; a slow consumer can grow memory unboundedly. Add an
  optional high-water mark with a drop-oldest / coalesce policy.
- **`binaryInterval`** — a separate (slower) poll interval for binary files, à la
  chokidar, to reduce CPU when polling large media trees.
- **`depth` option** — cap recursion depth for the manual/polling backends.

---

## 🐛 Correctness — known gaps

### Same-size, same-mtime, same-ctime edit
**Where:** [src/core/classifier.ts](src/core/classifier.ts)

Change detection now also compares `ctime`, which closes the common case. A write
that leaves size, mtime, **and** ctime identical is still dropped (extremely rare;
would require deliberate timestamp restoration). A content-hash fallback behind an
option is the only fully-robust fix, at the cost of I/O.

---

## 🧪 Testing / tooling (remaining)

- Add an explicit **close-during-startup** race test (the `#isClosed()` guards in
  `#start` are in place but only covered indirectly).
- Add direct coverage for the **manual recursive watcher** subtree add/remove
  (`#reconcile` / `#removeSubtree`) — exercised on Linux CI but not unit-tested.
- Consider **are-the-types-wrong** (`attw`) in CI to guard the dual-package
  `exports` map against types regressions.

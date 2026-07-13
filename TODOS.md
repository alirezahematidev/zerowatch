# zerowatch — TODOs & Improvement Backlog

Everything previously tracked here has been implemented. What remains below is a
record of completed work plus deliberate design decisions (not open tasks).

---

## ✅ Done

### Hardening pass

- **Cross-OS ignore consistency** — descendants of an ignored directory are
  suppressed on macOS/Windows too (ancestor-aware, memoized).
- **CommonJS + ESM** — dual build; `import` and `require` both work. Validated in
  CI with [`attw`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
  (all resolution modes green).
- **Bundled with tsup** — minified output (~19 KB/format).
- Fixed: close-during-startup race, unhandled `ready()` rejection, false same-path
  `move`, `off()` not removing a pending `once()`, Windows path normalization.

### Features & robustness

- **`getWatched()` / `add()` / `unwatch()`** — live watcher management.
- **Polling backend** (`usePolling`, `interval`) for network filesystems, with a
  separate **`binaryInterval`** / **`binaryExtensions`** cadence for large assets.
- **`depth`** — cap recursion (enforced in the scanner and for live events on all
  backends, including native recursive).
- **`maxBufferedEvents`** — bounded async-iterator buffer (drop-oldest) for
  backpressure against slow consumers.
- **`hashChanges`** — content-hash fallback that catches edits which restore size,
  mtime, *and* ctime.
- **`moveWindow`** configurable; **`flushOnClose`** drains buffered debounce/batch
  events on close.
- **Directory-move child pairing** — cascade deletes carry real inodes.
- **Sharper change detection** — compares `ctime` alongside size/mtime.
- **`awaitWrite`** settles on size **and** mtime.
- **Symlink-cycle protection** — the scanner tracks real dev:inode.
- **Nested brace-expansion** in ignore globs (`{a,{b,c}}`).
- **Emitter** skips the snapshot allocation for the single-listener case.

### Tooling & tests

- GitHub Actions **CI** across Linux/macOS/Windows × Node 20/22, plus a coverage
  job and an `attw` types check.
- **release-it** + conventional-changelog, **CONTRIBUTING.md**, **CHANGELOG.md**.
- New tests: bounded queue, depth (scan + live), `hashChanges`, `flushOnClose`,
  polling, `getWatched`/`add`/`unwatch`, close-during-startup race, and direct
  coverage of the manual per-directory watcher (`#reconcile` / `#removeSubtree`).
- Dependencies on latest stable (Vitest 4, tsup 8, release-it 20).

---

## 📐 Design decisions (intentional, not open tasks)

### Synchronous event classification

**Where:** [src/core/classifier.ts](src/core/classifier.ts)

The classifier `stat`s each raw notification **synchronously**. This guarantees
strict per-path event ordering and keeps the pipeline simple. It also means
sustained throughput on a hot micro-benchmark trails chokidar (~11k vs ~16k
ev/s), while cold-start is ~2.6× faster.

An async classification stage (bounded `fs.stat` pool) could close that gap, but
only safely if it preserves per-path ordering — a substantial change for an
uncertain, workload-dependent win. **Decision: keep synchronous classification.**
Revisit only if a real workload (not a micro-benchmark) shows classification is
the bottleneck; if so, gate the async path behind an opt-in and benchmark it.

### Depth relative to the primary root

`depth` is measured from the watcher's primary root. Paths attached later via
`add()` that live outside that root are watched in full (depth is not re-based per
added target). This keeps the common single-root case simple; revisit if
multi-root depth semantics are requested.

---

## ▶ Planned

- [ ] **`FinalizationRegistry` leak safety-net** — [src/core/watcher.ts](src/core/watcher.ts).
  If a `Watcher` is dropped without `close()`, its native `fs.watch` handles leak.
  Register the platform-watcher set (a holder object, *not* the `Watcher` itself,
  so it stays collectable) in a `FinalizationRegistry`; on finalization, close any
  handles that are still open. Built-in — no dependency, no zero-dep impact.
  *Caveats:* finalizers aren't guaranteed to run, so this is a backstop, not a
  substitute for `close()`; register the holder (never `this`) to avoid pinning
  the watcher alive. *Scope:* wire it in the constructor / `#start`, deregister in
  `close()`, add a documented note that explicit `close()` is still required.

- [ ] **typedoc API reference** (dev-only) — generate an HTML/Markdown API site
  from the existing JSDoc + types. *Scope:* add `typedoc` devDep, a `typedoc.json`
  (entry `src/index.ts`), a `docs:api` script, and a CI/publish step or committed
  output under `docs/`. Keeps the hand-written [docs/API.md](docs/API.md) as the
  narrative guide; typedoc covers the exhaustive symbol reference.

---

## 💡 Possible future enhancements (not planned)

- `binaryInterval` heuristics beyond extension matching (e.g. sniffing content).
- A `depth` re-basing mode for independently-rooted `add()` targets.
- Configurable content-hash algorithm for `hashChanges` (currently SHA-1).

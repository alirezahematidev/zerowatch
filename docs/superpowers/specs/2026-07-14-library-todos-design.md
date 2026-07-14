# Design: zerowatch library TODOs (#1, #3, #4)

**Date:** 2026-07-14
**Scope:** The three in-repo Planned items from [TODOS.md](../../../TODOS.md).
The `virtual-fs` dogfooding project (#2) is explicitly out of scope — it is a
standalone application deserving its own spec → plan → build cycle.

---

## Task #1 — `FinalizationRegistry` leak safety-net

### Problem

If a `Watcher` is dropped without `close()`, its native `fs.watch` handles leak
(they stay active, pinning file descriptors and keeping the event loop alive).
A `FinalizationRegistry` backstop should close such orphaned handles.

### Critical finding: the naive approach can never fire

An active `fs.watch` handle created with `{ persistent: true }` is a GC root:
Node's C++ `HandleWrap` holds a strong reference to the JS `FSWatcher` object
while the handle is active. That object owns its `'change'` listener, which — in
every platform adapter — is a closure over `this.#sink`, which closes over the
`Watcher`:

```
active fs.watch handle (GC root, held by libuv/HandleWrap)
  → FSWatcher JS object
    → 'change' listener closure
      → platform-watcher this.#sink
        → (event) => this.#onRaw(event)
          → Watcher
```

Consequently, while any handle is open the `Watcher` is strongly reachable and
is **never garbage-collected**. Registering the `Watcher` (or anything that
transitively references it) with a `FinalizationRegistry` therefore never fires
in the one situation it exists for — a dropped-without-`close()` watcher with
open handles. The naive implementation compiles, passes a trivial test, and is
inert in production.

### Fix: sever the handle→Watcher edge with a `WeakRef`

The platform layer references the sink through a `WeakRef<PlatformSink>` and
dereferences it per raw event. If `deref()` returns `undefined` (the `Watcher`
was collected), the event is dropped. This breaks the only strong edge from the
active handle back to the `Watcher`.

With that edge weak, the `Watcher` can maintain a **holder** object that has no
back-reference to the `Watcher`:

```ts
// holder is a plain object: the FinalizationRegistry holds it strongly, so it
// must NOT reference `this` (the Watcher), or the Watcher is pinned again.
const holder = { watchers: new Set<PlatformWatcher>() };
```

Because platform watchers now hold the sink weakly, `holder.watchers` can hold
the platform watchers themselves without pinning the `Watcher`. Reachability
after the user drops their reference:

```
FinalizationRegistry (root) → holder → PlatformWatcher → WeakRef(sink)  ✗ weak, no pin
active handle (root) → FSWatcher → listener → WeakRef(sink)             ✗ weak, no pin
```

Nothing strong reaches the `Watcher` except the user's own variable. Drop it →
GC collects the `Watcher` (and the sink) → registry fires → close every handle
in `holder.watchers` → fds released.

### Mechanics

- `#start()`: build `holder`, `registry.register(this, holder, this)` (the
  `Watcher` is the unregister token).
- Keep `holder.watchers` in sync with `#watchers`: add on `#startTarget`, delete
  on `unwatch`, clear on `close`.
- `close()`: `registry.unregister(this)` then normal teardown.
- Finalization callback: `for (const w of holder.watchers) void w.close()`.
  Guard against throwing; a finalizer must never throw.
- One `WeakRef.deref()` per raw event — negligible beside the classifier's
  existing synchronous `fs.stat`.

### Files touched

- `src/types/internal.ts` — document the weak-sink contract (the adapter holds
  the sink weakly).
- `src/platform/fs-watch.ts` — no change if the listener already goes through
  the adapter; the deref happens in the adapter (see below).
- `src/platform/file-watcher.ts`, `native-recursive-watcher.ts`,
  `manual-recursive-watcher.ts`, `polling-watcher.ts` — store
  `WeakRef<PlatformSink>`; deref at the top of each raw-event/ error path;
  drop the event when the referent is gone.
- `src/platform/index.ts` — `createPlatformWatcher` passes the sink; wrap once in
  a `WeakRef` at the boundary (adapters receive a `WeakRef<PlatformSink>`), OR
  each adapter wraps in its constructor. Decision: **wrap at the adapter
  constructor boundary** so the `createPlatformWatcher` signature is unchanged
  and the weak-ref concern stays inside the platform layer.
- `src/core/watcher.ts` — holder, registry wiring, unregister on close.

### Testing

GC-triggered finalization is inherently non-deterministic, so split the tests:

1. **Deterministic** (`test/watcher.test.ts` or a new `test/leak.test.ts`):
   - `close()` calls `registry.unregister` (assert via a spy / no double-close of
     handles). Verify a closed watcher's handles are closed exactly once.
   - `holder.watchers` stays in sync across `add()` / `unwatch()` / `close()`.
   - A raw event whose sink `WeakRef` derefs to a live sink is delivered
     normally (guards against the weak indirection breaking the hot path).
2. **Best-effort finalization** — gated on `typeof global.gc === "function"`
   (needs `--expose-gc`); `it.skipIf(!global.gc)`. Create a watcher, drop the
   reference, force GC, await a tick, assert the registered handles were closed
   (observed through a test-visible close counter on a fake platform watcher, or
   via `process`-level handle count). Skipped in normal CI runs so it never
   flakes the suite.

### Docs

Add a note in `docs/API.md` (and/or the `close()` JSDoc in `watcher.ts`) that the
`FinalizationRegistry` is a backstop only — finalizers are not guaranteed to run,
and explicit `close()` is still required.

---

## Task #3 — Bench against other chokidar alternatives

### Approach

`bench/index.ts` already iterates a list of `Adapter`s and benchmarks each for
cold-start and throughput. Extend the `adapters()` factory with more entries,
each behind a `try { await import(...) } catch { /* skip */ }` guard — matching
the existing chokidar pattern. **None of these become dependencies**; each is
benchmarked only when the user has installed it locally.

### Adapters to add

- **`@parcel/watcher`** — `subscribe(dir, cb)`; close via the returned
  subscription's `unsubscribe()`. Note: native backend differs per OS
  (FSEvents / inotify / Windows), so cross-OS numbers are not directly
  comparable.
- **`watchpack`** — `new Watchpack(opts)`, `.watch({ directories: [root] })`,
  `.close()`; count `'change'`/`'remove'`/`'aggregated'` as appropriate.
- **`sane`** — `sane(root)`, `.on('change'|'add'|'delete', …)`, `.close()`.
- **raw `node:fs.watch`** — always available; `fs.watch(root, {recursive:true})`.
  Note it does not recurse on Linux, so it under-reports there — documented as a
  caveat, not silently hidden.

### Dropped

- **`nodemon` / `node-dev`** — process-runners built on chokidar, not embeddable
  watch libraries. Benching them re-benches chokidar. Documented as an explicit
  non-goal rather than faked.

### Output

- The existing `runStartup` / `runThroughput` tables already render per adapter —
  more adapters means more rows, no table-code change required.
- Add `bench/README.md`: how to enable each watcher (`npm i -D <pkg>` then
  `npm run bench`), what "skipped" means, and the per-watcher platform caveats.

---

## Task #4 — typedoc API reference (dev-only)

### Approach

- Add `typedoc` as a **devDependency**.
- Add `typedoc.json` with `entryPoints: ["src/index.ts"]`, output `docs/api/`,
  sensible defaults (exclude internals, include version).
- Add `"docs:api": "typedoc"` script.
- Generated output (`docs/api/`) is **gitignored** — generated HTML is noisy to
  version. Add `docs/api/` to `.gitignore`.
- `docs/API.md` remains the hand-written narrative guide; typedoc covers the
  exhaustive symbol reference.
- Document the `docs:api` script in `CONTRIBUTING.md`.

---

## Out of scope

- Task #2 (`virtual-fs` dogfooding project) — separate project, separate spec.
- The `Possible future enhancements` section of TODOS.md — explicitly not planned.
- The `Design decisions` section — intentional, not tasks.

## Verification

- `yarn typecheck` clean.
- `yarn test` green (finalization test skipped without `--expose-gc`; runnable
  locally with `node --expose-gc`).
- `yarn build` succeeds.
- `yarn bench` runs zerowatch-only when no optional watchers are installed, and
  includes any that are, with no new hard dependencies (`package.json`
  `dependencies` stays empty).
- `yarn docs:api` generates `docs/api/` (gitignored).

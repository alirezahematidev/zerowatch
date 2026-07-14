# zerowatch Library TODOs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three in-repo Planned TODOs — a working `FinalizationRegistry` leak safety-net, extra benchmark adapters, and a dev-only typedoc API site.

**Architecture:** (1) A `WeakSink` façade wraps the real `PlatformSink` at the single `createPlatformWatcher` seam, severing the strong reference chain from an active `fs.watch` handle back to the `Watcher` so a `FinalizationRegistry` can fire; a module-level registry closes orphaned handles held in a back-reference-free holder. (2) The bench harness gains optional adapters behind import guards — zero new dependencies. (3) typedoc generates a gitignored `docs/api/` from `src/index.ts`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥20, vitest, tsup, tinybench, typedoc (new devDep).

## Global Constraints

- **Zero runtime dependencies.** `package.json` `dependencies` stays empty. Bench adapters and typedoc are dev-only / optional (`devDependencies` only).
- **ESM with explicit `.js` import specifiers** even for `.ts` files (e.g. `import { x } from "./leak-registry.js"`).
- **Node ≥20** (`FinalizationRegistry`, `WeakRef` are available).
- Tests import source via `../src/...js` specifiers and use `./helpers.js` (`tempDir`, `sleep`, `collect`, `waitFor`).
- Commit messages follow Conventional Commits (`feat`, `fix`, `test`, `docs`, `build`, `chore`).
- A `FinalizationRegistry` callback must never throw.

---

## Task 1: `WeakSink` façade + wrap at the platform seam

**Files:**
- Create: `src/platform/weak-sink.ts`
- Modify: `src/platform/index.ts` (wrap `sink` once inside `createPlatformWatcher`)
- Test: `test/leak.test.ts` (new)

**Interfaces:**
- Consumes: `PlatformSink`, `RawFsEvent` from `../types/internal.js`.
- Produces: `class WeakSink implements PlatformSink` with `constructor(sink: PlatformSink)`, `onEvent(event: RawFsEvent): void`, `onError(error: Error): void`.

- [ ] **Step 1: Write the failing test**

Create `test/leak.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WeakSink } from "../src/platform/weak-sink.js";
import type { PlatformSink, RawFsEvent } from "../src/types/internal.js";

describe("WeakSink", () => {
  it("forwards events and errors while the referent is alive", () => {
    const events: RawFsEvent[] = [];
    const errors: Error[] = [];
    const real: PlatformSink = {
      onEvent: (e) => events.push(e),
      onError: (err) => errors.push(err),
    };
    const weak = new WeakSink(real);

    const raw: RawFsEvent = { kind: "change", absolutePath: "/tmp/x" };
    weak.onEvent(raw);
    const err = new Error("boom");
    weak.onError(err);

    expect(events).toEqual([raw]);
    expect(errors).toEqual([err]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/leak.test.ts`
Expected: FAIL — cannot resolve `../src/platform/weak-sink.js` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/platform/weak-sink.ts`:

```ts
import type { PlatformSink, RawFsEvent } from "../types/internal.js";

/**
 * A {@link PlatformSink} façade that references the real sink **weakly**.
 *
 * An active `fs.watch` handle is a GC root, and it strongly references its
 * `'change'` listener — which closes over the platform adapter's sink, which
 * closes over the owning `Watcher`. Left strong, that chain pins the `Watcher`
 * in memory for as long as any handle is open, so the leak-safety
 * {@link FinalizationRegistry} could never fire. Routing the adapter → sink
 * edge through a `WeakRef` severs it: once the `Watcher` (and its sink) are
 * collected, `deref()` returns `undefined` and further notifications are
 * dropped, leaving the handle collectable and the registry free to fire.
 */
export class WeakSink implements PlatformSink {
  readonly #ref: WeakRef<PlatformSink>;

  constructor(sink: PlatformSink) {
    this.#ref = new WeakRef(sink);
  }

  onEvent(event: RawFsEvent): void {
    this.#ref.deref()?.onEvent(event);
  }

  onError(error: Error): void {
    this.#ref.deref()?.onError(error);
  }
}
```

- [ ] **Step 4: Wrap the sink at the seam**

In `src/platform/index.ts`, add the import (with the other adapter imports):

```ts
import { WeakSink } from "./weak-sink.js";
```

Then, at the very top of `createPlatformWatcher`'s body (before the `if (options.usePolling)` block), wrap the sink and use the wrapped one everywhere the function currently passes `sink`:

```ts
export function createPlatformWatcher(
  target: PlatformWatchTarget,
  sink: PlatformSink,
  shouldWatchDir: (absolutePath: string) => boolean,
  options: PlatformOptions,
): PlatformWatcher {
  // Adapters reference the sink weakly so an active fs.watch handle never pins
  // the owning Watcher — see WeakSink and the leak-safety FinalizationRegistry.
  const weakSink = new WeakSink(sink);

  if (options.usePolling) {
    return new PollingWatcher(
      target.absolutePath,
      target.isDirectory && target.recursive,
      weakSink,
      shouldWatchDir,
      target.followSymlinks,
      options.interval,
      options.binaryInterval,
      options.binaryExtensions,
    );
  }

  if (!target.isDirectory) {
    return new FileWatcher(target.absolutePath, weakSink);
  }

  if (target.recursive && nativeRecursiveSupported) {
    return new NativeRecursiveWatcher(target.absolutePath, weakSink);
  }

  return new ManualRecursiveWatcher(
    target.absolutePath,
    target.recursive,
    weakSink,
    shouldWatchDir,
  );
}
```

(The four adapter constructors are unchanged — they receive a `PlatformSink` and neither know nor care that it is weak.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run test/leak.test.ts && yarn typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Run the full suite to confirm event delivery is unaffected**

Run: `yarn vitest run`
Expected: All existing tests PASS — the weak wrap must not change delivery behavior for a live watcher (the user holds a strong reference throughout a test).

- [ ] **Step 7: Commit**

```bash
git add src/platform/weak-sink.ts src/platform/index.ts test/leak.test.ts
git commit -m "feat: weak-reference platform sink so leak backstop can fire

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Leak registry + `Watcher` wiring

**Files:**
- Create: `src/core/leak-registry.ts`
- Modify: `src/core/watcher.ts` (holder field, register in `#start`, sync in `#startTarget`/`unwatch`, unregister+clear in `close`)
- Modify: `docs/API.md` (backstop note)
- Test: `test/leak.test.ts` (extend)

**Interfaces:**
- Consumes: `PlatformWatcher` from `../types/internal.js`.
- Produces:
  - `interface WatcherHolder { readonly watchers: Set<PlatformWatcher> }`
  - `function closeLeakedWatchers(holder: WatcherHolder): void`
  - `const leakRegistry: FinalizationRegistry<WatcherHolder>`

- [ ] **Step 1: Write the failing test**

Append to `test/leak.test.ts`:

```ts
import { closeLeakedWatchers } from "../src/core/leak-registry.js";
import type { PlatformWatcher } from "../src/types/internal.js";

describe("closeLeakedWatchers", () => {
  function fakeWatcher(onClose: () => void): PlatformWatcher {
    return { start: async () => {}, close: async () => { onClose(); } };
  }

  it("closes every watcher in the holder and empties the set", () => {
    let closed = 0;
    const holder = {
      watchers: new Set([fakeWatcher(() => closed++), fakeWatcher(() => closed++)]),
    };

    closeLeakedWatchers(holder);

    expect(closed).toBe(2);
    expect(holder.watchers.size).toBe(0);
  });

  it("keeps going when a watcher's close() throws (finalizers must not throw)", () => {
    let closed = 0;
    const holder = {
      watchers: new Set<PlatformWatcher>([
        { start: async () => {}, close: () => { throw new Error("nope"); } },
        fakeWatcher(() => closed++),
      ]),
    };

    expect(() => closeLeakedWatchers(holder)).not.toThrow();
    expect(closed).toBe(1);
    expect(holder.watchers.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/leak.test.ts`
Expected: FAIL — cannot resolve `../src/core/leak-registry.js`.

- [ ] **Step 3: Write the leak-registry module**

Create `src/core/leak-registry.ts`:

```ts
import type { PlatformWatcher } from "../types/internal.js";

/**
 * A back-reference-free holder for a watcher's platform handles.
 *
 * The {@link leakRegistry} holds this object strongly, so it MUST NOT reference
 * the owning `Watcher` (directly or transitively) — otherwise the `Watcher`
 * would be pinned in memory and the registry could never fire. Because the
 * platform adapters reference their sink weakly (see `WeakSink`), holding the
 * adapters here does not pin the `Watcher`.
 */
export interface WatcherHolder {
  readonly watchers: Set<PlatformWatcher>;
}

/** Close every platform handle in `holder`, swallowing errors, then clear it. */
export function closeLeakedWatchers(holder: WatcherHolder): void {
  for (const watcher of holder.watchers) {
    try {
      void watcher.close();
    } catch {
      // A FinalizationRegistry callback must never throw.
    }
  }
  holder.watchers.clear();
}

/**
 * Backstop for a `Watcher` dropped without `close()`. When such a watcher is
 * garbage-collected, this closes any native `fs.watch` handles it left open.
 * Finalizers are not guaranteed to run — this is a safety net, not a substitute
 * for calling `close()`.
 */
export const leakRegistry = new FinalizationRegistry<WatcherHolder>(closeLeakedWatchers);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/leak.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the registry into `Watcher`**

In `src/core/watcher.ts`:

(a) Add the import after the other `./`-relative core imports (near line 19):

```ts
import { leakRegistry, type WatcherHolder } from "./leak-registry.js";
```

(b) Add a holder field immediately after the `#watchers` field (line 65):

```ts
  /** Platform adapters keyed by their target's absolute path (for unwatch()). */
  readonly #watchers = new Map<string, PlatformWatcher>();
  /**
   * Same platform adapters, in a back-reference-free holder registered with the
   * leak-safety FinalizationRegistry. Kept in sync with #watchers.
   */
  readonly #holder: WatcherHolder = { watchers: new Set() };
  #sink!: PlatformSink;
```

(c) Register at the top of `#start()`, right after `this.#state = "starting";`:

```ts
    this.#state = "starting";
    // Backstop: if this Watcher is dropped without close(), the registry closes
    // any handles still in #holder. `this` is also the unregister token.
    leakRegistry.register(this, this.#holder, this);
```

(d) In `#startTarget()`, keep the holder in sync right after `this.#watchers.set(...)`:

```ts
    this.#watchers.set(target.absolutePath, platform);
    this.#holder.watchers.add(platform);
    await platform.start();
```

(e) In `unwatch()`, after `this.#watchers.delete(target.absolutePath);`:

```ts
      this.#watchers.delete(target.absolutePath);
      this.#holder.watchers.delete(watcher);
      await watcher.close();
```

(f) In `close()`, right after `this.#state = "closed";`:

```ts
    this.#state = "closed";
    // close() supersedes the backstop: stop tracking so the finalizer is a no-op.
    leakRegistry.unregister(this);
    this.#holder.watchers.clear();
```

- [ ] **Step 6: Add the API doc note**

In `docs/API.md`, find the section documenting `close()` and append this note (adapt heading level to the surrounding document):

```markdown
> **Resource cleanup:** Always call `close()` when you are done with a watcher —
> it releases native `fs.watch` handles and ends the async iterator. As a
> backstop, a `Watcher` dropped without `close()` will have its handles closed
> when it is eventually garbage-collected, but finalizers are **not guaranteed
> to run** (and may run arbitrarily late), so explicit `close()` remains
> required for deterministic cleanup.
```

- [ ] **Step 7: Run typecheck and full suite**

Run: `yarn typecheck && yarn vitest run`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/leak-registry.ts src/core/watcher.ts docs/API.md test/leak.test.ts
git commit -m "feat: FinalizationRegistry backstop for watchers dropped without close()

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Best-effort GC finalization test (gated)

**Files:**
- Test: `test/leak.test.ts` (extend)

**Interfaces:**
- Consumes: `leakRegistry`, `closeLeakedWatchers` from `../src/core/leak-registry.js`; `PlatformWatcher` from `../src/types/internal.js`.

- [ ] **Step 1: Add the gated finalization test**

Append to `test/leak.test.ts`:

```ts
import { leakRegistry } from "../src/core/leak-registry.js";

const gc = (globalThis as { gc?: () => void }).gc;

describe("leakRegistry (GC-gated)", () => {
  // Requires `node --expose-gc`. Skipped otherwise so normal CI never flakes on
  // non-deterministic garbage collection.
  it.skipIf(!gc)("closes tracked handles when the owner is collected", async () => {
    let closed = 0;
    const watcher: PlatformWatcher = {
      start: async () => {},
      close: async () => { closed++; },
    };
    const holder = { watchers: new Set([watcher]) };

    // `owner` stands in for a Watcher; the holder must not reference it back.
    let owner: object | null = {};
    leakRegistry.register(owner, holder, owner);

    owner = null; // drop the only strong reference
    gc!();
    // Finalization callbacks run on a later microtask/turn after collection.
    await new Promise((r) => setTimeout(r, 50));
    gc!();
    await new Promise((r) => setTimeout(r, 50));

    expect(closed).toBe(1);
    expect(holder.watchers.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the gated test with GC exposed**

Run: `NODE_OPTIONS=--expose-gc yarn vitest run test/leak.test.ts`
Expected: PASS — the `GC-gated` test runs (not skipped) and confirms the finalizer fires and closes the handle. (Vitest runs tests in worker processes; `NODE_OPTIONS` propagates the flag to them, whereas a bare `node --expose-gc` on the outer process does not.)

- [ ] **Step 3: Run without GC to confirm it skips cleanly**

Run: `yarn vitest run test/leak.test.ts`
Expected: PASS — the `GC-gated` test is reported as skipped; everything else passes.

- [ ] **Step 4: Commit**

```bash
git add test/leak.test.ts
git commit -m "test: gated GC finalization test for the leak backstop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Bench against other watchers

**Files:**
- Modify: `bench/index.ts` (add optional adapters)
- Create: `bench/README.md`

**Interfaces:**
- Consumes: the existing `Adapter` interface (`{ name: string; start(root, onEvent): Promise<BenchWatcher> }`) and `adapters()` factory in `bench/index.ts`.

- [ ] **Step 1: Add optional adapters to the harness**

In `bench/index.ts`, add these imports at the top (alongside the existing `node:fs` import — merge into the existing import if present):

```ts
import { watch as fsWatch } from "node:fs";
```

Add a generic optional-module loader next to `loadChokidar`:

```ts
/** Try to import an optional watcher; return null (skip) if it isn't installed. */
async function tryImport<T>(name: string): Promise<T | null> {
  try {
    return (await import(name)) as T;
  } catch {
    return null;
  }
}
```

Then, inside `adapters()`, after the chokidar block and before `return list;`, append the optional adapters. Each is added only when its module imports successfully, so none are dependencies:

```ts
  // @parcel/watcher — native backend (FSEvents/inotify/Windows); differs per OS.
  const parcel = await tryImport<typeof import("@parcel/watcher")>("@parcel/watcher");
  if (parcel) {
    list.push({
      name: "@parcel/watcher",
      async start(root, onEvent) {
        const sub = await parcel.subscribe(root, (_err, events) => {
          for (let i = 0; i < events.length; i++) onEvent();
        });
        return { close: () => sub.unsubscribe() };
      },
    });
  }

  // watchpack (webpack) — no reliable "ready" signal; resolve after watch() returns.
  const watchpack = await tryImport<{ default: new (opts?: unknown) => any }>("watchpack");
  if (watchpack) {
    list.push({
      name: "watchpack",
      async start(root, onEvent) {
        const Watchpack = watchpack.default;
        const wp = new Watchpack({});
        wp.on("change", () => onEvent());
        wp.on("remove", () => onEvent());
        wp.watch({ directories: [root] });
        return { close: () => wp.close() };
      },
    });
  }

  // sane — emits change/add/delete and a ready event.
  const sane = await tryImport<{ default: (dir: string, opts?: unknown) => any }>("sane");
  if (sane) {
    list.push({
      name: "sane",
      async start(root, onEvent) {
        const w = sane.default(root);
        await new Promise<void>((resolve) => w.on("ready", () => resolve()));
        w.on("change", () => onEvent());
        w.on("add", () => onEvent());
        w.on("delete", () => onEvent());
        return { close: () => w.close() };
      },
    });
  }

  // Raw node:fs.watch — always available. NOTE: recursive:true is unsupported on
  // Linux, so throughput is under-reported there (documented in bench/README.md).
  list.push({
    name: "node:fs.watch (raw)",
    async start(root, onEvent) {
      const w = fsWatch(root, { recursive: true, persistent: true }, () => onEvent());
      return { close: () => w.close() };
    },
  });
```

- [ ] **Step 2: Verify the harness still runs with none of the optional watchers installed**

Run: `yarn build && node bench/index.ts`
Expected: Runs `zerowatch` and `node:fs.watch (raw)` (and `chokidar` if present); the tables render extra rows without errors. Optional libraries that aren't installed are silently omitted.

- [ ] **Step 3: Write `bench/README.md`**

Create `bench/README.md`:

```markdown
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
| watchpack | `watchpack` | webpack's watcher; has no reliable "ready" event, so its startup number includes only `watch()` setup, not a full initial scan. |
| sane | `sane` | Node-based fallback watcher. |
| node:fs.watch (raw) | built-in | Always run. `{ recursive: true }` is **not supported on Linux**, so throughput is under-reported there. |

### Not benchmarked

`nodemon` / `node-dev` are process runners built on top of `chokidar`, not
embeddable watch APIs — benchmarking them would just re-measure `chokidar`, so
they are intentionally excluded.

## Scenarios

- **Startup** — cold time to `ready` over a 5,000-file tree (50 dirs).
- **Throughput** — time to deliver 1,000 events after editing 1,000 distinct files.
```

- [ ] **Step 4: Commit**

```bash
git add bench/index.ts bench/README.md
git commit -m "feat(bench): optional adapters for parcel/watchpack/sane/raw fs.watch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: typedoc API reference (dev-only)

**Files:**
- Modify: `package.json` (devDep + `docs:api` script)
- Create: `typedoc.json`
- Modify: `.gitignore` (ignore `docs/api/`)
- Modify: `CONTRIBUTING.md` (document `docs:api`)

**Interfaces:** none (tooling only).

- [ ] **Step 1: Add typedoc as a dev dependency**

Run: `yarn add -D typedoc`
Expected: `typedoc` appears under `devDependencies` in `package.json`; `yarn.lock` updated.

- [ ] **Step 2: Add the `docs:api` script**

In `package.json` `scripts`, add after the `attw` line:

```json
    "docs:api": "typedoc",
```

- [ ] **Step 3: Create `typedoc.json`**

Create `typedoc.json`:

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": ["src/index.ts"],
  "out": "docs/api",
  "excludeInternal": true,
  "excludePrivate": true,
  "includeVersion": true,
  "readme": "none"
}
```

- [ ] **Step 4: Gitignore the generated output**

In `.gitignore`, add:

```
docs/api/
```

- [ ] **Step 5: Generate the site and verify**

Run: `yarn docs:api`
Expected: typedoc completes without errors and writes HTML into `docs/api/` (e.g. `docs/api/index.html`).

Run: `git status --porcelain docs/api`
Expected: no output — `docs/api/` is gitignored and does not show as untracked.

- [ ] **Step 6: Document it in CONTRIBUTING**

In `CONTRIBUTING.md`, add this section immediately before the `## Releasing (maintainers)` section:

```markdown
## API docs (dev-only)

The exhaustive symbol reference is generated from the source JSDoc + types with
[typedoc](https://typedoc.org):

```sh
yarn docs:api
```

Output is written to `docs/api/` (gitignored — not committed). The hand-written
[docs/API.md](docs/API.md) remains the narrative guide.
```

- [ ] **Step 7: Commit**

```bash
git add package.json yarn.lock typedoc.json .gitignore CONTRIBUTING.md
git commit -m "docs: add dev-only typedoc API reference generation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Update TODOS.md

**Files:**
- Modify: `TODOS.md` (remove the three completed Planned items)

- [ ] **Step 1: Remove completed items**

In `TODOS.md`, delete the three `Planned` bullets now implemented: the
`FinalizationRegistry` item, the "Bench against other chokidar alternatives"
item, and the "typedoc API reference" item. Leave the `virtual-fs` dogfooding
item (out of scope this session), the `Design decisions` section, and the
`Possible future enhancements` section untouched.

- [ ] **Step 2: Commit**

```bash
git add TODOS.md
git commit -m "docs: drop completed library TODOs (leak net, bench, typedoc)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `yarn typecheck` — clean.
- [ ] `yarn vitest run` — all pass; GC-gated leak test reported as skipped.
- [ ] `node --expose-gc ./node_modules/.bin/vitest run test/leak.test.ts` — GC-gated test runs and passes.
- [ ] `yarn build` — succeeds.
- [ ] `node bench/index.ts` — runs; includes `node:fs.watch (raw)` plus any installed optional watchers; no hard-dependency additions (`package.json` `dependencies` still empty/absent).
- [ ] `yarn docs:api` — generates gitignored `docs/api/`.

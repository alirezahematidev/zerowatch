# Design: chokidar-parity pass (glob targets, event stats, docs)

**Date:** 2026-07-16
**Scope:** Three cohesive "competitive parity" improvements that close the gaps a
chokidar user hits when evaluating or migrating to `zerowatch`:

- **A — Glob watch targets** (new feature; the centerpiece).
- **B — `Stats` on events** (new feature; small).
- **C — Documentation parity fix** (near-zero code; corrects an actively
  misleading migration guide and documents already-shipped methods).

**Non-goals:** a CLI, an `alwaysStat`-style opt-in, stats on `delete`/`move`,
async event classification (an intentional design decision — see the archived
TODOs), and any new runtime dependency (`package.json` `dependencies` stays
empty).

---

## Background — the discovery that shaped this

While grounding the design we found that **`getWatched()`, `add()`, `unwatch()`,
and `pause()/resume()` are already implemented and (mostly) tested**
(`src/core/watcher.ts`; `getWatched()` is covered in `test/features.test.ts`).
Yet the migration guide tells chokidar users the opposite in three places:

- `docs/MIGRATION.md` — "No `getWatched()`" (it exists).
- `docs/MIGRATION.md` — "arbitrary depth capping is not exposed" (`depth` exists).
- `docs/MIGRATION.md` — "No polling mode" (`usePolling` / `interval` exist).

So part of "parity" is not building anything — it is correcting docs that
undersell the library to the exact audience meant to adopt it. That is Feature C.

The genuinely new capabilities are Features A and B.

---

## Feature A — Glob watch targets

### Problem

`Watcher.#toTargets` (`src/core/watcher.ts`) resolves each target string with
`path.resolve` then `statSync`s it. A glob such as `"src/**/*.ts"` resolves to a
literal path containing `*`, which does not exist, so it is assumed to be a
directory and a watch is attached to a non-existent path — nothing useful
happens. Today globs work only for `ignore`, never for choosing *what to watch*.

Goal:

```ts
watch("src/**/*.ts");                       // only .ts under src, any depth
watch(["assets/**/*.png", "src/**/*.{ts,tsx}"]);
watch(["src", "lib/**/*.ts"]);              // literal + glob targets mixed
await watcher.add("test/**/*.spec.ts");     // globs at runtime too
```

### Key insight — reuse the existing allow-list machinery

Two facts about the current code make this cheap and non-invasive:

1. `extensions` is already a **file allow-list**: `IgnoreEngine.ignoresFile`
   enforces it, while `IgnoreEngine.ignoresDirectory` deliberately does **not**,
   so directory events pass through and recursion keeps working (see the
   `extensions` JSDoc in `src/types/options.ts`).
2. `IgnoreEngine` already matches globs against **both** the root-relative POSIX
   path **and** the absolute path (`#matchesIgnoreRules`).

A glob watch target is simply a **positive allow-list** ("scope") that layers on
top of the existing deny-list, reusing both facts.

### Approach — "base + scope allow-list" (recommended)

1. **Split each target string** into a static base directory + the glob, via two
   new pure helpers in `src/ignore/glob.ts`:

   ```ts
   /** True when the string contains any glob metacharacter (`* ? [ {`). */
   export function isGlob(input: string): boolean;

   /** Split "src/**\/*.ts" into { base: "src", pattern: "src/**\/*.ts" }. */
   export function splitGlobBase(pattern: string): { base: string; pattern: string };
   ```

   `base` is the join of the leading run of glob-free path segments; parsing
   stops at the first segment containing a metacharacter.
   - `"src/**/*.ts"` → base `"src"`
   - `"assets/img/*.png"` → base `"assets/img"`
   - `"**/*.ts"` → base `""` (→ resolves to `cwd`)
   - `"src/a/b.ts"` → not a glob (handled as a literal path, unchanged behavior)

2. **Watch the base recursively.** In `#toTargets`, when `isGlob(target)`, the
   `PlatformWatchTarget.absolutePath` becomes the resolved *base*, with
   `isDirectory: true, recursive: true`. Physical watching is unchanged — we just
   watch the right directory.

3. **Scope allow-list in `IgnoreEngine`.** Each target contributes one or more
   compiled **absolute** scope globs:
   - A glob target `G` → `compileGlob(resolveAbsolute(cwd, G))`.
   - A literal target `P` → `compileGlob(absP)` **and** `compileGlob(absP + "/**")`
     so a plain `watch("src")` matches `src` itself and everything beneath it.

   A **file** is in scope iff it matches ≥1 scope glob. `IgnoreEngine.ignoresFile`
   returns `true` (ignore) when scope is **active** and the file matches none of
   them — exactly mirroring how `extensions` is enforced. Scope globs are matched
   against `toPosix(absolutePath)`, so this is independent of `#root` and needs no
   relativization.

   **Scope is enforced only when at least one target is a glob.** A watcher with
   only literal targets (the overwhelmingly common `watch("src")` case) leaves
   scope **inactive**, so `ignoresFile` does zero extra glob-testing on the hot
   path — behavior and performance are identical to today. Scope activates the
   moment any glob target is present.

   To make activation safe, **every** target contributes its scope globs as it is
   resolved (a literal `P` → `absP` + `absP/**`; a glob `G` → its absolute
   pattern), regardless of whether scope is currently active. Enforcement is
   gated on the separate `active` flag. That way a literal added before any glob
   is already represented in scope if a later glob flips activation on.

   **Directories are unaffected** (`ignoresDirectory` does not consult scope), so
   the tree is still fully traversed to find deep matches, and directory
   create/delete events still fire — consistent with `extensions`. This is the
   approved behavior decision.

4. **Runtime `add()`.** `IgnoreEngine` gains `extendScope(globs, active)`, called
   from the `add()` path for every added target: it pushes the target's scope
   globs and, if the added target is itself a glob, flips scope active. Because
   activation never flips back and all prior literal targets already contributed
   their scope globs, introducing the *first* glob via `add()` cannot retroactively
   filter out files under previously-watched literal targets.

5. **Root computation.** `#computeRoot` must use the *base* of a single glob
   target rather than the literal glob string, so event `relativePath`s are
   sensible (relative to the watched base). For multiple targets the root stays
   `cwd`, unchanged.

### Ordering of the two decisions

- **Emit** a file event ⇔ `inScope(file) && !ignored(file)` — scope (allow-list)
  and `ignore`/`gitignore`/`extensions` (deny-list) compose naturally; both live
  in `IgnoreEngine`.
- **Descend** into a directory ⇔ `!ignoresDirectory(dir) && withinDepth(dir)` —
  unchanged; scope never prunes traversal.

### Interactions / edge cases

- **`ignore` + glob target:** ignore still wins (deny-list applied after the
  allow-list), so `watch("src/**/*.ts", { ignore: ["**/*.d.ts"]})` works.
- **`extensions` + glob target:** both allow-lists apply (AND). Redundant but
  harmless.
- **`depth` + glob target:** independent; both enforced.
- **`watch.file`:** treats its argument as a **literal** path (globs are a
  directory-watching concept). Documented; no glob splitting on the file path.
- **Escaped metacharacters / literal `[` in filenames:** rare; `isGlob` treats
  them as globs. Documented as a known limitation (matches most glob libraries).
- **Case sensitivity:** scope globs compile with the same `caseInsensitiveFs`
  flag the ignore globs already use, so behavior matches the platform.

### Files touched (A)

- `src/ignore/glob.ts` — add `isGlob`, `splitGlobBase`.
- `src/ignore/ignore-engine.ts` — `#scope: GlobMatcher[]` + `#scopeActive`
  flag, consult scope in `ignoresFile` only when active, add
  `extendScope(globs, active)`, accept initial scope + active flag in `create`.
- `src/core/watcher.ts` — glob-aware `#toTargets` (base extraction + scope
  collection), glob-aware `#computeRoot`, install scope into the `IgnoreEngine`,
  extend scope from `add()`. Resolve targets *before* building the ignore engine
  so scope is known at construction.
- `src/core/resolve-options.ts` — no change expected (targets, not options).

### Tests (A)

- Unit (`test/glob.test.ts` style): `isGlob` truth table; `splitGlobBase` cases
  including `**/*.ts` (empty base), no-glob literal, deep base, brace/`?`/class.
- Integration (`test/features.test.ts` style, using `tempDir`/`waitFor` helpers):
  - `watch("<tmp>/**/*.ts")` emits `.ts` create/change, suppresses `.js`.
  - Array of globs; mixed literal + glob targets.
  - `add()` with a glob extends coverage live.
  - A file created later under a subdir still matches (proves live scope, not
    eager expansion).
  - `ignore` overrides scope; directory events still fire (behavior lock-in).

---

## Feature B — `Stats` on events

### Design

- Add an optional field to `WatchEvent` (`src/types/events.ts`):

  ```ts
  /**
   * The live `fs.Stats` for the entry, present on `create` and `change` only.
   * Absent on `delete`/`move` (no live file at emit time). Under `awaitWrite`
   * this reflects the file once writing has settled.
   */
  readonly stats?: import("node:fs").Stats;
  ```

  Type-only import keeps the value side dependency-free.

- `EventFactory.create(type, absolutePath, isDirectory, stats?)` attaches `stats`
  when provided (`src/events/factory.ts`).

- **Live path** (`src/core/classifier.ts`): the classifier already has the live
  `Stats` in hand for the `create`, `change`, and type-flip `replacement` create
  branches — pass it to the factory. The `"gone"`/`delete`, cascade-delete, and
  directory branches pass nothing.

- **Initial scan** (`src/scanner/scanner.ts` + `src/core/watcher.ts`): so that
  initial `create`s (when `ignoreInitial` is false) also carry stats, thread the
  `Stats` **transiently** out of the scan. `scan()` returns
  `Map<string, { entry: FsEntry; stats: Stats }>`; `#seed` and `#scanNewDirectory`
  use `stats` to build the create event but store only `entry` in `#snapshot`.
  The long-lived snapshot keeps holding the lightweight `FsEntry` (no `Stats`
  retained), so memory over large trees is unchanged; the `Stats` objects are
  released as soon as seeding finishes.

- **`awaitWrite`** (`src/scanner/write-stabilizer.ts`): when a held create/change
  is released as stable, the stabilizer performs one final `stat` and attaches it
  (as `{ ...event, stats }`), so `stats.size` reflects the finished file rather
  than the partial size observed at first detection. If that final stat fails,
  the event is emitted without `stats` (never dropped).

- No opt-in flag: stats are free where they exist, so always attached; documented
  precisely which event types carry them.

### Files touched (B)

- `src/types/events.ts` — add `stats?`.
- `src/events/factory.ts` — accept + attach `stats`.
- `src/core/classifier.ts` — pass stats on create/change/replacement.
- `src/scanner/scanner.ts` — widen `scan()` return to include transient `Stats`.
- `src/core/watcher.ts` — `#seed` / `#scanNewDirectory` consume the new shape.
- `src/scanner/write-stabilizer.ts` — refresh `stats` at release.

### Tests (B)

- Unit: `EventFactory` attaches/omits `stats`.
- Integration:
  - `create`/`change` events carry `stats` with a plausible `size`/`mtimeMs` and
    working `stats.isFile()`.
  - `delete` (and a `move`) carry no `stats`.
  - Initial-scan `create`s carry `stats` when `ignoreInitial` is false.
  - Under `awaitWrite`, a create that grows before settling reports the final
    (stable) `size`, not the initial partial size.

---

## Feature C — Documentation parity fix

### `docs/API.md`

- New sections documenting `add(paths)`, `unwatch(paths)`, and `getWatched()`
  (shape: `Record<string, string[]>` of parent dir → child basenames, matching
  the chokidar-compatible implementation).
- Add `stats?` to the `WatchEvent` field table with the "create/change only" note.
- Under `watch(path, options?)`, document glob targets (base extraction, scope
  semantics, the directory-events-pass-through behavior) with an example.

### `docs/MIGRATION.md`

- Correct the `depth` row: it maps to zerowatch's `depth` (supported), not
  "not exposed".
- Correct the polling rows: `usePolling` / `interval` are supported.
- Remove "No `getWatched()`" from "intentionally different"; add `getWatched()`
  to a supported-parity list.
- Add rows/notes for glob watch targets and `event.stats`.

### `README.md`

- One-line mention of glob targets in the options blurb and a short `event.stats`
  note. Keep it light — API.md holds the detail.

### Files touched (C)

- `docs/API.md`, `docs/MIGRATION.md`, `README.md`. No code, no tests.

---

## Verification

- `yarn typecheck` — clean (new `stats?` type, widened `scan()` return, scope
  field all type-check).
- `yarn test` — all green, including new A/B tests; existing suite unaffected
  (no-glob/no-stats callers see identical behavior).
- `yarn build` — succeeds (ESM + CJS + d.ts); `stats?` surfaces in the `.d.ts`.
- `yarn attw` — published types still correct.
- `package.json` `dependencies` remains empty.
- Manual sanity: `watch("src/**/*.ts")` over this repo emits only `.ts` events;
  `event.stats?.size` is populated on create/change.

## Suggested task decomposition for the plan

1. Glob helpers (`isGlob`, `splitGlobBase`) + unit tests.
2. `IgnoreEngine` scope allow-list + `extendScope`.
3. Wire scope + base extraction into `Watcher` (`#toTargets`, `#computeRoot`,
   `add()`), integration tests.
4. `WatchEvent.stats` + factory + classifier (live path) tests.
5. Initial-scan stats threading + `awaitWrite` refresh, tests.
6. Docs parity fix (API.md, MIGRATION.md, README.md).

# chokidar-parity pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add glob watch targets (`watch("src/**/*.ts")`) and `fs.Stats` on `create`/`change` events, and correct the migration guide that wrongly claims three already-shipped features are missing.

**Architecture:** Glob targets reuse the existing allow-list machinery — each target contributes absolute "scope" globs to `IgnoreEngine`, enforced in `ignoresFile` exactly like `extensions` (directories always pass, so traversal is unaffected); scope is only *enforced* when a target is actually a glob, so the common literal-path watch pays nothing. Event stats are free where the classifier already `stat`s; initial-scan stats are threaded transiently out of `scan()` without bloating the long-lived snapshot, and `awaitWrite` refreshes stats at release.

**Tech Stack:** TypeScript (ESM, explicit `.js` import specifiers, `verbatimModuleSyntax`), Node ≥20, vitest, tsup.

## Global Constraints

- **Zero runtime dependencies.** `package.json` `dependencies` stays empty.
- **ESM with explicit `.js` import specifiers** even in `.ts` source; `import type` for type-only imports.
- **Node ≥20.**
- **Cross-platform.** Paths are matched as POSIX (`toPosix`); globs compile with the platform's `caseInsensitiveFs` flag.
- Tests import source via `../src/...js` specifiers; FS-watch tests use `test/helpers.ts` (`tempDir`, `sleep`, `collect`, `waitFor`) and run serially.
- Conventional Commits. A design spec for this work lives at `docs/superpowers/specs/2026-07-16-chokidar-parity-design.md`.
- **Never `git push`.** Commit locally only.

---

## Task 1: Glob helpers (`isGlob`, `splitGlobBase`)

**Files:**
- Modify: `src/ignore/glob.ts` (add two exported functions)
- Test: `test/glob.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export function isGlob(input: string): boolean`
  - `export function splitGlobBase(pattern: string): { base: string; pattern: string }`

- [ ] **Step 1: Write the failing tests**

Append to `test/glob.test.ts`:

```ts
import { isGlob, splitGlobBase } from "../src/ignore/glob.js";

describe("isGlob", () => {
  it("detects glob metacharacters", () => {
    expect(isGlob("src/**/*.ts")).toBe(true);
    expect(isGlob("a/b?.ts")).toBe(true);
    expect(isGlob("a/[abc].ts")).toBe(true);
    expect(isGlob("a/{x,y}.ts")).toBe(true);
  });
  it("treats plain paths as non-globs", () => {
    expect(isGlob("src/index.ts")).toBe(false);
    expect(isGlob("src")).toBe(false);
    expect(isGlob("")).toBe(false);
  });
});

describe("splitGlobBase", () => {
  it("returns the leading glob-free segments as the base", () => {
    expect(splitGlobBase("src/**/*.ts").base).toBe("src");
    expect(splitGlobBase("assets/img/*.png").base).toBe("assets/img");
  });
  it("returns an empty base when the first segment globs", () => {
    expect(splitGlobBase("**/*.ts").base).toBe("");
    expect(splitGlobBase("*.ts").base).toBe("");
  });
  it("tolerates backslash separators", () => {
    expect(splitGlobBase("src\\**\\*.ts").base).toBe("src");
  });
  it("echoes the original pattern back", () => {
    expect(splitGlobBase("src/**/*.ts").pattern).toBe("src/**/*.ts");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run test/glob.test.ts`
Expected: FAIL — `isGlob`/`splitGlobBase` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/ignore/glob.ts`:

```ts
/** Glob metacharacters that distinguish a pattern from a literal path. */
const GLOB_METACHARS = /[*?[\]{}]/;

/** True when `input` contains any glob metacharacter (`* ? [ ] { }`). */
export function isGlob(input: string): boolean {
  return GLOB_METACHARS.test(input);
}

/**
 * Split a glob pattern into its static base directory — the leading run of
 * segments containing no glob metacharacter — and the original pattern.
 * Separators (`/` or `\`) are both recognized; the returned `base` is POSIX
 * (`/`-joined) and safe to pass to `path.resolve`.
 *
 *   "src/**\/*.ts"     -> { base: "src",        pattern: "src/**\/*.ts" }
 *   "assets/img/*.png" -> { base: "assets/img", pattern: "assets/img/*.png" }
 *   "**\/*.ts"         -> { base: "",           pattern: "**\/*.ts" }
 */
export function splitGlobBase(pattern: string): { base: string; pattern: string } {
  const segments = pattern.split(/[\\/]/);
  const baseSegments: string[] = [];
  for (const segment of segments) {
    if (isGlob(segment)) break;
    baseSegments.push(segment);
  }
  return { base: baseSegments.join("/"), pattern };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/glob.test.ts && yarn typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ignore/glob.ts test/glob.test.ts
git commit -m "feat(glob): add isGlob and splitGlobBase helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `IgnoreEngine` scope allow-list

**Files:**
- Modify: `src/ignore/ignore-engine.ts`
- Test: `test/ignore-engine.test.ts` (extend)

**Interfaces:**
- Consumes: `GlobMatcher`, `compileGlob` (already imported in the engine); `isGlob`/`splitGlobBase` are not needed here.
- Produces:
  - `IgnoreEngine.create(root, options, scope?: GlobMatcher[], scopeActive?: boolean)` — two new optional params (default `[]` / `false`, so existing callers are unaffected).
  - `IgnoreEngine.prototype.extendScope(globs: GlobMatcher[], active: boolean): void`
  - Unchanged behavior when `scopeActive` is `false`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ignore-engine.test.ts` (the file already defines `root` and `p`):

```ts
import { compileGlob } from "../src/ignore/glob.js";
import { toPosix } from "../src/utils/paths.js";
import { caseInsensitiveFs } from "../src/platform/capabilities.js";

describe("IgnoreEngine scope allow-list (glob watch targets)", () => {
  const ci = { caseInsensitive: caseInsensitiveFs };
  const tsScope = () => [compileGlob(`${toPosix(p("src"))}/**/*.ts`, ci)];

  it("emits only in-scope files; directories always pass for traversal", () => {
    const eng = IgnoreEngine.create(root, {}, tsScope(), true);
    expect(eng.ignoresFile(p("src", "a.ts"))).toBe(false);
    expect(eng.ignoresFile(p("src", "deep", "b.ts"))).toBe(false);
    expect(eng.ignoresFile(p("src", "a.js"))).toBe(true); // out of scope
    expect(eng.ignoresFile(p("other", "a.ts"))).toBe(true); // outside the base
    expect(eng.ignoresDirectory(p("src", "deep"))).toBe(false); // dirs unaffected
  });

  it("does not enforce scope when inactive", () => {
    const eng = IgnoreEngine.create(root, {}, tsScope(), false);
    expect(eng.ignoresFile(p("src", "a.js"))).toBe(false);
    expect(eng.ignoresFile(p("any", "thing.png"))).toBe(false);
  });

  it("extendScope activates and grows the allow-list", () => {
    const eng = IgnoreEngine.create(root, {});
    expect(eng.ignoresFile(p("lib", "x.js"))).toBe(false); // inactive: allowed
    eng.extendScope([compileGlob(`${toPosix(p("lib"))}/**/*.ts`, ci)], true);
    expect(eng.ignoresFile(p("lib", "x.ts"))).toBe(false);
    expect(eng.ignoresFile(p("lib", "x.js"))).toBe(true); // now enforced
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run test/ignore-engine.test.ts`
Expected: FAIL — `create` ignores the extra args and `extendScope` does not exist, so the scope assertions fail / the method is undefined.

- [ ] **Step 3: Add the scope fields and constructor params**

In `src/ignore/ignore-engine.ts`, add two fields after `#ignoreHidden` (near line 30):

```ts
  readonly #ignoreHidden: boolean;
  /** Positive allow-list of absolute-path globs for glob watch targets. */
  #scope: GlobMatcher[];
  /** Whether the scope allow-list is enforced (true once any target is a glob). */
  #scopeActive: boolean;
```

Extend the private constructor signature and body:

```ts
  private constructor(
    root: string,
    globs: GlobMatcher[],
    predicates: IgnoreFunction[],
    gitignore: GitignoreSet | null,
    extensions: Set<string> | null,
    ignoreHidden: boolean,
    scope: GlobMatcher[],
    scopeActive: boolean,
  ) {
    this.#root = root;
    this.#globs = globs;
    this.#predicates = predicates;
    this.#gitignore = gitignore;
    this.#extensions = extensions;
    this.#ignoreHidden = ignoreHidden;
    this.#scope = scope;
    this.#scopeActive = scopeActive;
  }
```

- [ ] **Step 4: Thread scope through `create` and add `extendScope`**

Change the `create` factory (near line 51) to accept and forward the scope:

```ts
  static create(
    root: string,
    options: WatchOptions,
    scope: GlobMatcher[] = [],
    scopeActive = false,
  ): IgnoreEngine {
    const { globs, predicates } = splitIgnoreInput(options.ignore);
    const gitignore = options.gitignore ? loadRootGitignore(root, caseInsensitiveFs) : null;
    const extensions =
      options.extensions && options.extensions.length > 0
        ? new Set(options.extensions.map(normalizeExtension))
        : null;
    return new IgnoreEngine(
      root,
      globs,
      predicates,
      gitignore,
      extensions,
      options.ignoreHidden ?? false,
      scope,
      scopeActive,
    );
  }

  /**
   * Grow the scope allow-list at runtime (used by `Watcher.add`). Pushing a
   * literal target's globs while inactive is harmless; passing `active: true`
   * (a glob target) begins enforcement. Activation never reverts, and because
   * every target contributes its globs as it is added, activating later cannot
   * retroactively filter out already-watched literal targets.
   */
  extendScope(globs: GlobMatcher[], active: boolean): void {
    for (const glob of globs) this.#scope.push(glob);
    if (active) this.#scopeActive = true;
  }
```

- [ ] **Step 5: Enforce scope in `ignoresFile`**

Add a helper (place it next to `#isHidden`):

```ts
  /**
   * True when scope is active and this file matches none of the scope globs.
   * Scope globs are compiled against the absolute POSIX path, so this is
   * independent of `#root`. Inactive scope allows everything, so a watcher with
   * only literal targets does no extra glob-testing here.
   */
  #outOfScope(absolutePath: string): boolean {
    if (!this.#scopeActive) return false;
    const posixAbs = toPosix(absolutePath);
    for (const glob of this.#scope) {
      if (glob.test(posixAbs)) return false;
    }
    return true;
  }
```

Then insert the check near the top of `ignoresFile` (after the `#isHidden` check):

```ts
  ignoresFile(absolutePath: string): boolean {
    const rel = relativeTo(this.#root, absolutePath);
    if (this.#isHidden(rel)) return true;
    if (this.#outOfScope(absolutePath)) return true;
    if (this.#matchesIgnoreRules(absolutePath, rel, false)) return true;
    if (this.#extensions && !this.#extensions.has(extname(absolutePath))) return true;
    return this.#ancestorIgnored(absolutePath);
  }
```

(`ignoresDirectory` is intentionally left unchanged — directories always pass so recursion still finds deep matches. `toPosix` is already imported in this file.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn vitest run test/ignore-engine.test.ts && yarn typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Run the full suite (guard against regressions)**

Run: `yarn vitest run`
Expected: All PASS — existing callers pass no scope, so `#scopeActive` is `false` and behavior is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/ignore/ignore-engine.ts test/ignore-engine.test.ts
git commit -m "feat(ignore): scope allow-list for glob watch targets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire glob targets into `Watcher`

**Files:**
- Modify: `src/core/watcher.ts`
- Test: `test/features.test.ts` (extend)

**Interfaces:**
- Consumes: `isGlob`, `splitGlobBase`, `compileGlob`, `GlobMatcher` from `../ignore/glob.js`; `caseInsensitiveFs` from `../platform/capabilities.js`; `toPosix` from `../utils/paths.js`; `IgnoreEngine.create(root, options, scope, active)` and `extendScope` from Task 2.
- Produces: a private `#resolveTarget(raw: string): { platform: PlatformWatchTarget; scopeGlobs: GlobMatcher[]; isGlob: boolean }` and glob-aware startup / `add` / `#computeRoot`.

- [ ] **Step 1: Write the failing integration tests**

Append to `test/features.test.ts` (add `rmSync` to the `node:fs` import at the top of the file):

```ts
describe("glob watch targets", () => {
  it("emits only files matching the glob, ignoring others", async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "keep.ts"), "1");
    writeFileSync(join(dir, "src", "skip.js"), "1");

    const w = watch(join(dir, "src", "**", "*.ts"), { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.relativePath));

    writeFileSync(join(dir, "src", "added.ts"), "2");
    writeFileSync(join(dir, "src", "added.js"), "2");
    await waitFor(() => seen.some((p) => p.endsWith("added.ts")), 5000);
    await sleep(150);
    expect(seen.some((p) => p.endsWith("added.ts"))).toBe(true);
    expect(seen.some((p) => p.endsWith(".js"))).toBe(false);
  });

  it("matches files created later in new subdirectories (live scope)", async () => {
    const dir = makeDir();
    const w = watch(join(dir, "**", "*.ts"), { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.relativePath));

    mkdirSync(join(dir, "nested"));
    await sleep(150); // let a per-dir (Linux) watcher attach
    writeFileSync(join(dir, "nested", "deep.ts"), "x");
    await waitFor(() => seen.some((p) => p.endsWith("deep.ts")), 5000);
    expect(seen.some((p) => p.endsWith("deep.ts"))).toBe(true);
  });

  it("still emits everything for a literal target mixed with a glob", async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "lit"));
    mkdirSync(join(dir, "globbed"));

    const w = watch([join(dir, "lit"), join(dir, "globbed", "**", "*.ts")], {
      ignoreInitial: true,
    });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.absolutePath));

    writeFileSync(join(dir, "lit", "anything.json"), "1"); // literal → allowed
    writeFileSync(join(dir, "globbed", "in.ts"), "1"); // glob match → allowed
    writeFileSync(join(dir, "globbed", "out.md"), "1"); // glob miss → suppressed
    await waitFor(
      () => seen.some((p) => p.endsWith("anything.json")) && seen.some((p) => p.endsWith("in.ts")),
      5000,
    );
    await sleep(150);
    expect(seen.some((p) => p.endsWith("anything.json"))).toBe(true);
    expect(seen.some((p) => p.endsWith("in.ts"))).toBe(true);
    expect(seen.some((p) => p.endsWith("out.md"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run test/features.test.ts -t "glob watch targets"`
Expected: FAIL — a glob path currently resolves to a non-existent literal directory, so no matching events arrive and the `waitFor`/assertions fail.

- [ ] **Step 3: Add imports**

In `src/core/watcher.ts`, extend the existing imports:

```ts
import { relativeTo, toPosix } from "../utils/paths.js";
import { createPlatformWatcher, inodeMoveDetectionSupported } from "../platform/index.js";
import { compileGlob, isGlob, splitGlobBase, type GlobMatcher } from "../ignore/glob.js";
import { caseInsensitiveFs } from "../platform/capabilities.js";
```

(The first line replaces the current `import { relativeTo } from "../utils/paths.js";`.)

- [ ] **Step 4: Add `#resolveTarget` and remove `#resolveTargets`/rewrite `#toTargets`**

Replace the existing `#resolveTargets` and `#toTargets` methods (near line 593) with:

```ts
  /**
   * Resolve a raw target string into the platform target to watch plus the
   * scope globs it contributes. A glob target watches its static base directory
   * recursively and contributes the (absolute) glob as a scope filter; a literal
   * target watches the path itself and contributes `path` + `path/**` so its
   * entries stay in scope if another target later activates scope filtering.
   */
  #resolveTarget(raw: string): {
    platform: PlatformWatchTarget;
    scopeGlobs: GlobMatcher[];
    isGlob: boolean;
  } {
    const cwd = this.#options.cwd;
    const ci = { caseInsensitive: caseInsensitiveFs };

    if (isGlob(raw)) {
      const baseAbs = path.resolve(cwd, splitGlobBase(raw).base);
      const patternPosix = toPosix(path.resolve(cwd, raw));
      return {
        platform: {
          absolutePath: baseAbs,
          isDirectory: true,
          recursive: this.#options.recursive,
          followSymlinks: this.#options.followSymlinks,
        },
        scopeGlobs: [compileGlob(patternPosix, ci)],
        isGlob: true,
      };
    }

    const abs = path.resolve(cwd, raw);
    let isDirectory = true;
    try {
      isDirectory = fs.statSync(abs).isDirectory();
    } catch {
      // Assume directory if it doesn't exist yet; watch may still fail loudly.
    }
    const posixAbs = toPosix(abs);
    return {
      platform: {
        absolutePath: abs,
        isDirectory,
        recursive: isDirectory && this.#options.recursive,
        followSymlinks: this.#options.followSymlinks,
      },
      scopeGlobs: [compileGlob(posixAbs, ci), compileGlob(`${posixAbs}/**`, ci)],
      isGlob: false,
    };
  }

  #toTargets(paths: string[]): PlatformWatchTarget[] {
    return paths.map((raw) => this.#resolveTarget(raw).platform);
  }
```

- [ ] **Step 5: Build scope before the ignore engine in `#start`**

In `#start` (near line 289), replace the ignore-engine creation and the later `this.#resolveTargets()` call. Immediately after the `leakRegistry.register(...)` line, insert the target resolution and pass scope into `IgnoreEngine.create`:

```ts
    leakRegistry.register(this, this.#holder, this);

    // Resolve targets up front: glob targets contribute the scope allow-list the
    // ignore engine needs at construction, and expand to the base dir we watch.
    const resolved = this.#targets.map((raw) => this.#resolveTarget(raw));
    const scopeGlobs = resolved.flatMap((r) => r.scopeGlobs);
    const scopeActive = resolved.some((r) => r.isGlob);

    this.#ignore = IgnoreEngine.create(this.#root, this.#options.raw, scopeGlobs, scopeActive);
```

Then inside the `try` block, replace `const targets = this.#resolveTargets();` with:

```ts
      const targets = resolved.map((r) => r.platform);
```

- [ ] **Step 6: Extend scope from `add()`**

Replace the body loop of `add()` (near line 214) so each added target grows the scope before it is started:

```ts
    for (const raw of list) {
      const resolved = this.#resolveTarget(raw);
      // Grow the allow-list so the added target's entries pass; a glob target
      // also begins enforcement (activation never reverts).
      this.#ignore.extendScope(resolved.scopeGlobs, resolved.isGlob);
      const target = resolved.platform;
      if (this.#watchers.has(target.absolutePath)) continue;
      await this.#startTarget(target);
      if (this.#isClosed()) return;
      await this.#seed(target);
    }
```

(The `for (const target of this.#toTargets(list))` line is what this replaces.)

- [ ] **Step 7: Make `#computeRoot` glob-aware**

In `#computeRoot` (near line 580), handle a single glob target by rooting at its base:

```ts
  #computeRoot(): string {
    const cwd = this.#options.cwd;
    if (this.#targets.length === 1) {
      const raw = this.#targets[0]!;
      if (isGlob(raw)) {
        // Root at the glob's static base so event relativePaths are meaningful.
        return path.resolve(cwd, splitGlobBase(raw).base);
      }
      const abs = path.resolve(cwd, raw);
      try {
        return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
      } catch {
        return abs;
      }
    }
    return path.resolve(cwd);
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `yarn vitest run test/features.test.ts -t "glob watch targets" && yarn typecheck`
Expected: PASS; typecheck clean. (If `#resolveTargets` is referenced anywhere else, the typecheck will flag it — there should be no other reference.)

- [ ] **Step 9: Run the full suite**

Run: `yarn vitest run`
Expected: All PASS — literal-only watches resolve exactly as before (scope inactive).

- [ ] **Step 10: Commit**

```bash
git add src/core/watcher.ts test/features.test.ts
git commit -m "feat: support glob watch targets (watch(\"src/**/*.ts\"))

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `WatchEvent.stats` + factory + classifier (live path)

**Files:**
- Modify: `src/types/events.ts`, `src/events/factory.ts`, `src/core/classifier.ts`
- Test: `test/unit.test.ts` (extend), `test/features.test.ts` (extend)

**Interfaces:**
- Consumes: `Stats` from `node:fs` (type-only).
- Produces:
  - `WatchEvent.stats?: import("node:fs").Stats`
  - `EventFactory.create(type, absolutePath, isDirectory, stats?: Stats): WatchEvent`
  - classifier passes the live `Stats` on `create`/`change`/replacement-create.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit.test.ts`:

```ts
import { EventFactory } from "../src/events/factory.js";
import { statSync } from "node:fs";

describe("EventFactory stats", () => {
  it("attaches stats when provided and omits them otherwise", () => {
    const f = new EventFactory("/root", () => 123);
    const s = statSync("package.json");
    expect(f.create("create", "/root/a.ts", false, s).stats).toBe(s);
    expect(f.create("delete", "/root/a.ts", false).stats).toBeUndefined();
  });
});
```

Append to `test/features.test.ts`:

```ts
describe("event stats", () => {
  it("carries stats on create and change, but not delete", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const byType = new Map<string, WatchEvent>();
    w.on("all", (e) => byType.set(e.type, e));

    const file = join(dir, "f.txt");
    writeFileSync(file, "hello");
    await waitFor(() => byType.has("create"), 5000);
    writeFileSync(file, "hello world");
    await waitFor(() => byType.has("change"), 5000);
    rmSync(file);
    await waitFor(() => byType.has("delete"), 5000);

    expect(byType.get("create")?.stats?.isFile()).toBe(true);
    expect(typeof byType.get("change")?.stats?.size).toBe("number");
    expect(byType.get("delete")?.stats).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run test/unit.test.ts test/features.test.ts -t "stats"`
Expected: FAIL — `create` does not accept a 4th arg / events have no `stats`.

- [ ] **Step 3: Add `stats` to `WatchEvent`**

In `src/types/events.ts`, add the import at the top and the field to `WatchEvent` (after `isDirectory`):

```ts
import type { Stats } from "node:fs";
```

```ts
  /**
   * The live `fs.Stats` for the entry when the event was produced. Present on
   * `create` and `change` only; absent on `delete` and `move` (no live file to
   * stat). Under `awaitWrite`, this reflects the file once its size has settled.
   */
  readonly stats?: Stats;
```

- [ ] **Step 4: Accept `stats` in `EventFactory.create`**

In `src/events/factory.ts`, add the type import and the optional param:

```ts
import type { Stats } from "node:fs";
```

```ts
  create(
    type: WatchEventType,
    absolutePath: string,
    isDirectory: boolean | undefined,
    stats?: Stats,
  ): WatchEvent {
    const relativePath = relativeTo(this.#root, absolutePath);
    return {
      type,
      path: relativePath,
      absolutePath,
      relativePath,
      timestamp: this.#now(),
      ...(isDirectory !== undefined ? { isDirectory } : {}),
      ...(stats !== undefined ? { stats } : {}),
    };
  }
```

- [ ] **Step 5: Pass live stats from the classifier**

In `src/core/classifier.ts`, add `stats` to the four create/change factory calls. `stats` is already the narrowed `Stats` in scope at each site:

- New-entry create (near line 103):
  ```ts
      const event = this.#factory.create("create", absolutePath, isDirectory, stats);
  ```
- Type-flip replacement create (near line 116):
  ```ts
      const createEvent = this.#factory.create("create", absolutePath, isDirectory, stats);
  ```
- Hash-confirmed change (near line 148):
  ```ts
      return { event: this.#factory.create("change", absolutePath, false, stats), ino: Number(stats.ino), dev: Number(stats.dev) };
  ```
- Ordinary change (near line 152):
  ```ts
      const event = this.#factory.create("change", absolutePath, false, stats);
  ```

(The `delete` and cascade-delete factory calls are left unchanged — no live file.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn vitest run test/unit.test.ts test/features.test.ts -t "stats" && yarn typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/types/events.ts src/events/factory.ts src/core/classifier.ts test/unit.test.ts test/features.test.ts
git commit -m "feat: attach fs.Stats to create and change events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Initial-scan stats threading + `awaitWrite` refresh

**Files:**
- Modify: `src/scanner/scanner.ts`, `src/core/watcher.ts`, `src/scanner/write-stabilizer.ts`
- Test: `test/features.test.ts` (extend)

**Interfaces:**
- Consumes: `EventFactory.create(..., stats?)` from Task 4; `Stats` from `node:fs`.
- Produces:
  - `export interface ScannedEntry { readonly entry: FsEntry; readonly stats: Stats }`
  - `scan(...)` now returns `Promise<Map<string, ScannedEntry>>` (the map is transient; the long-lived `#snapshot` still stores only `FsEntry`).

- [ ] **Step 1: Write the failing tests**

Append to `test/features.test.ts`:

```ts
describe("initial-scan stats", () => {
  it("initial create events carry stats", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "seed.txt"), "hello"); // 5 bytes
    const w = watch(dir); // ignoreInitial defaults to false
    cleanups.push(() => void w.close());

    let seed: WatchEvent | undefined;
    w.on("create", (e) => {
      if (e.relativePath === "seed.txt") seed = e;
    });
    await w.ready();
    await waitFor(() => seed !== undefined, 5000);
    expect(seed?.stats?.size).toBe(5);
  });
});

describe("awaitWrite stats", () => {
  it("reports the settled size, not the partial size", async () => {
    const dir = makeDir();
    const w = watch(dir, {
      ignoreInitial: true,
      awaitWrite: { stabilityThreshold: 100, pollInterval: 25 },
    });
    cleanups.push(() => void w.close());
    await w.ready();

    const creates: WatchEvent[] = [];
    w.on("create", (e) => creates.push(e));

    const file = join(dir, "big.bin");
    writeFileSync(file, "aaaa"); // 4 bytes seen first
    await sleep(30);
    writeFileSync(file, "aaaaaaaaaa"); // grows to 10 before settling
    await waitFor(() => creates.length > 0, 5000);
    expect(creates[0]!.stats?.size).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run test/features.test.ts -t "stats"`
Expected: FAIL — initial-scan creates and stabilized creates carry no `stats` yet.

- [ ] **Step 3: Widen the scanner return to carry transient stats**

In `src/scanner/scanner.ts`, add the interface after `FsEntry` (near line 20):

```ts
/**
 * A scanned entry plus its raw `Stats`. The `stats` is transient — used to
 * populate initial `create` events during seeding and then discarded, so the
 * long-lived snapshot keeps storing only the lightweight `FsEntry`.
 */
export interface ScannedEntry {
  readonly entry: FsEntry;
  readonly stats: Stats;
}
```

Change `scan`'s return type and the three `entries.set(...)` calls:

```ts
export async function scan(
  root: string,
  options: ScanOptions,
  ignore: IgnoreEngine,
  onError: (error: Error) => void,
): Promise<Map<string, ScannedEntry>> {
  const entries = new Map<string, ScannedEntry>();
  const rootStats = await safeStat(root, onError);
  if (!rootStats) return entries;

  if (!rootStats.isDirectory()) {
    entries.set(root, { entry: toEntry(root, rootStats), stats: rootStats });
    return entries;
  }
```

For the directory branch (near line 111):

```ts
        entries.set(abs, { entry: toEntry(abs, stats), stats });
```

For the file branch (near line 121):

```ts
        entries.set(abs, { entry: toEntry(abs, stats), stats });
```

- [ ] **Step 4: Consume the new shape in the watcher (seed + scan-new-dir)**

In `src/core/watcher.ts` `#seed` (near line 435):

```ts
    for (const [abs, { entry, stats }] of entries) {
      if (this.#snapshot.has(abs)) continue;
      this.#snapshot.set(abs, entry);
      if (!this.#options.ignoreInitial) {
        const event = this.#factory.create("create", abs, entry.isDirectory, stats);
        this.#dispatch(event);
      }
    }
```

In `#scanNewDirectory` (near line 558):

```ts
    for (const [abs, { entry, stats }] of entries) {
      if (this.#snapshot.has(abs)) continue;
      this.#snapshot.set(abs, entry);
      const event = this.#factory.create("create", abs, entry.isDirectory, stats);
      this.#moveDetector.feed(event, entry.ino, entry.dev);
    }
```

- [ ] **Step 5: Refresh stats when the write-stabilizer releases an event**

In `src/scanner/write-stabilizer.ts` `#poll`, the stable branch (near line 139) attaches the fresh `stats` from the poll's `fs.stat` callback:

```ts
        if (entry.ticks >= this.#requiredStableTicks) {
          this.#pending.delete(absolutePath);
          // Emit with the freshly polled stats so size/mtime reflect the settled
          // file, not the partial state observed when the event was classified.
          entry.emit({ ...entry.event, stats });
          return;
        }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn vitest run test/features.test.ts -t "stats" && yarn typecheck`
Expected: PASS; typecheck clean. (`test/hardening.test.ts` calls `scan()` but only reads `.keys()`, so it is unaffected — the full suite in the next step confirms.)

- [ ] **Step 7: Run the full suite**

Run: `yarn vitest run`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add src/scanner/scanner.ts src/core/watcher.ts src/scanner/write-stabilizer.ts test/features.test.ts
git commit -m "feat: stats on initial-scan creates and settled awaitWrite events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Documentation parity fix

**Files:**
- Modify: `docs/API.md`, `docs/MIGRATION.md`, `README.md`
- No tests (documentation only).

**Interfaces:** none.

- [ ] **Step 1: Document new methods and options in `docs/API.md`**

In the `WatchOptions` intro / `watch(path, options?)` section, add a note that a target may be a glob:

````markdown
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
treats its argument as a literal path, not a glob.
````

Add `stats` to the `WatchEvent` table (after the `isDirectory` row):

```markdown
| `stats` | `fs.Stats` | Present on `create`/`change` only; absent on `delete`/`move`. Under `awaitWrite`, reflects the settled file. |
```

Add sections documenting the already-shipped methods after `pause()/resume()`:

```markdown
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
```

- [ ] **Step 2: Correct the stale claims in `docs/MIGRATION.md`**

In the "Options mapping" table, replace the `depth` and `usePolling` rows:

```markdown
| `depth` | `depth` (max recursion depth; `recursive: false` = depth 0) |
| `usePolling` / `interval` | `usePolling` / `interval` (opt-in polling backend) |
```

In the "Things that are intentionally different" list, **remove** the
`getWatched()` and polling bullets and replace the section with the accurate set:

```markdown
## Things that are intentionally different

- **Paths are objects, not strings** — every callback receives a `WatchEvent`
  (with `absolutePath`, `relativePath`, `isDirectory`, and `stats` on
  `create`/`change`).
- **Batching & debouncing are first-class** — no need for userland wrappers.
- **`move` is a first-class event** — a rename is one `move` (with `oldPath`),
  not an `unlink` + `add` pair.

## chokidar features with direct equivalents

- **`getWatched()`** — supported, same `{ dir: string[] }` shape.
- **`add()` / `unwatch()`** — supported.
- **Glob paths** — supported as watch targets (`watch("src/**/*.ts")`).
- **Polling** — supported via `usePolling` / `interval`.
- **`depth`** — supported.
```

- [ ] **Step 3: Mention the new features in `README.md`**

In the "Common options" area / feature bullets, add glob targets and `stats`:

```markdown
- 🎯 Glob watch targets (`watch("src/**/*.ts")`) and `fs.Stats` on create/change events.
```

- [ ] **Step 4: Verify the docs build cleanly and links are intact**

Run: `yarn build`
Expected: succeeds (docs are not compiled, but this confirms nothing else broke).

Manually skim `docs/MIGRATION.md` to confirm no remaining "No `getWatched()`" / "No polling mode" / "not exposed" (depth) claims.

- [ ] **Step 5: Commit**

```bash
git add docs/API.md docs/MIGRATION.md README.md
git commit -m "docs: document glob targets, event stats, add/unwatch/getWatched; fix stale migration claims

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `yarn typecheck` — clean.
- [ ] `yarn vitest run` — all pass (new glob + stats tests included; existing suite unaffected).
- [ ] `yarn build` — succeeds (ESM + CJS + d.ts; `stats?` and glob behavior surface in `.d.ts`).
- [ ] `yarn attw` — published types still correct.
- [ ] `package.json` `dependencies` remains empty.
- [ ] Manual: `node -e` / a scratch script watching `"src/**/*.ts"` over this repo emits only `.ts` file events and `event.stats?.size` is populated on create/change.

## Self-review notes (already applied)

- **Spec coverage:** Feature A → Tasks 1–3; Feature B → Tasks 4–5; Feature C → Task 6. All spec sections map to a task.
- **Type consistency:** `IgnoreEngine.create(root, options, scope?, active?)` and `extendScope(globs, active)` are used identically in Tasks 2 and 3; `EventFactory.create(..., stats?)` is defined in Task 4 and consumed in Task 5; `ScannedEntry { entry, stats }` is produced in Task 5 Step 3 and destructured in Step 4.
- **No placeholders:** every code step shows the exact code; every run step shows the exact command and expected result.

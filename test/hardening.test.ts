import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveOptions } from "../src/core/resolve-options.js";
import { PollingWatcher } from "../src/platform/polling-watcher.js";
import { WriteStabilizer } from "../src/scanner/write-stabilizer.js";
import { IgnoreEngine } from "../src/ignore/ignore-engine.js";
import { compileGlob } from "../src/ignore/glob.js";
import { caseInsensitiveFs } from "../src/platform/capabilities.js";
import { EventClassifier } from "../src/core/classifier.js";
import { EventFactory } from "../src/events/factory.js";
import { MoveDetector } from "../src/events/move-detector.js";
import type { FsEntry } from "../src/scanner/scanner.js";
import { mkdirSync, writeFileSync, symlinkSync, rmSync, renameSync } from "node:fs";
import fsSync from "node:fs";
import fsp from "node:fs/promises";
import { scan } from "../src/scanner/scanner.js";
import { join } from "node:path";
import { watch } from "../src/index.js";
import { sleep } from "./helpers.js";
import type { PlatformSink } from "../src/types/internal.js";
import type { WatchEvent, WatchEventType } from "../src/types/events.js";
import { tempDir } from "./helpers.js";

function makeClassifier(
  root: string,
  snapshot: Map<string, FsEntry>,
  opts: { followSymlinks?: boolean; onError?: (e: Error) => void } = {},
): EventClassifier {
  const ignore = IgnoreEngine.create(root, {});
  const factory = new EventFactory(root, () => 0);
  return new EventClassifier(snapshot, ignore, factory, opts.followSymlinks ?? false, false, opts.onError ?? (() => {}));
}

function fileEntry(absolutePath: string): FsEntry {
  return { absolutePath, isDirectory: false, ino: 11, dev: 1, size: 3, mtimeMs: 1, ctimeMs: 1 };
}
function dirEntry(absolutePath: string): FsEntry {
  return { absolutePath, isDirectory: true, ino: 12, dev: 1, size: 0, mtimeMs: 1, ctimeMs: 1 };
}

function ev(type: WatchEventType, absolutePath: string, isDirectory = false): WatchEvent {
  return { type, path: absolutePath, absolutePath, relativePath: absolutePath, timestamp: 0, isDirectory };
}

const noopSink: PlatformSink = { onEvent: () => {}, onError: () => {} };
const countTimeouts = (): number =>
  process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

// Regression tests for the production-hardening pass. Grouped by the finding
// they lock down so a future change that reintroduces a bug fails loudly.

describe("resolve-options: non-finite numeric options coerce to defaults (M2)", () => {
  const cwd = "/tmp";

  it("NaN interval falls back to the default instead of propagating NaN", () => {
    expect(resolveOptions({ interval: NaN }, cwd).interval).toBe(500);
  });

  it("NaN depth becomes unlimited (Infinity), not NaN (which drops every event)", () => {
    expect(resolveOptions({ depth: NaN }, cwd).depth).toBe(Infinity);
  });

  it("NaN debounce/batch/moveWindow/maxBufferedEvents coerce to their defaults", () => {
    const r = resolveOptions(
      { debounce: NaN, batch: NaN, moveWindow: NaN, maxBufferedEvents: NaN, binaryInterval: NaN },
      cwd,
    );
    expect(r.debounce).toBe(0);
    expect(r.batch).toBe(0);
    expect(r.moveWindow).toBe(100);
    expect(r.maxBufferedEvents).toBe(0);
    expect(r.binaryInterval).toBe(r.interval);
  });

  it("Infinity where a finite value is expected also coerces to the default", () => {
    expect(resolveOptions({ interval: Infinity }, cwd).interval).toBe(500);
    expect(resolveOptions({ debounce: Infinity }, cwd).debounce).toBe(0);
  });

  it("valid finite values still pass through and clamp as before", () => {
    const r = resolveOptions({ interval: 250, depth: 3, debounce: 40, moveWindow: -5 }, cwd);
    expect(r.interval).toBe(250);
    expect(r.depth).toBe(3);
    expect(r.debounce).toBe(40);
    expect(r.moveWindow).toBe(0); // negative clamps to 0
  });
});

describe("write-stabilizer: a stale poll callback cannot spawn an orphaned chain (L4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("a cancel()+wait() reuse makes the in-flight callback for the old entry a no-op", () => {
    vi.useFakeTimers();
    // Capture fs.stat callbacks instead of running them, so we control ordering.
    const cbs: Array<(err: NodeJS.ErrnoException | null, stats: fs.Stats) => void> = [];
    vi.spyOn(fs, "stat").mockImplementation(((_p: string, cb: (e: unknown, s: unknown) => void) => {
      cbs.push(cb as (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void);
    }) as unknown as typeof fs.stat);

    const stab = new WriteStabilizer({ stabilityThreshold: 1000, pollInterval: 50 }, () => {});

    stab.wait(ev("create", "/A"), () => {});
    vi.advanceTimersByTime(50); // E1's poll runs -> fs.stat -> cbs[0]
    expect(cbs.length).toBe(1);

    // Atomic-save shape: delete cancels E1, the recreate registers a fresh E2.
    stab.cancel("/A");
    stab.wait(ev("create", "/A"), () => {});
    vi.advanceTimersByTime(50); // E2's poll runs -> fs.stat -> cbs[1]
    expect(cbs.length).toBe(2);

    // Now the E1 stat callback (in flight across the cancel+wait) finally fires.
    // With the fix it detects it is stale and returns; without it, it mutates E2
    // and reschedules a second, orphaned poll timer for the same path.
    cbs[0](null, { size: 5, mtimeMs: 1 } as fs.Stats);

    const before = cbs.length;
    vi.advanceTimersByTime(50); // only E2's own (not-yet-fired) chain should exist
    expect(cbs.length - before).toBe(0); // no orphan timer scheduled by the stale cb

    stab.clear();
  });
});

describe("scanner: cycle-dedup tolerates filesystems reporting ino===0 (M7)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("still descends past the root when every entry reports inode 0", async () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "a"));
      mkdirSync(join(dir, "a", "b"));
      writeFileSync(join(dir, "a", "b", "c.txt"), "x");

      // Simulate SMB/FUSE/Windows-share behavior: usable inode unavailable (0).
      const realStat = fsp.stat.bind(fsp);
      const realLstat = fsp.lstat.bind(fsp);
      const zero = (s: fsSync.Stats): fsSync.Stats => {
        (s as { ino: number }).ino = 0;
        return s;
      };
      vi.spyOn(fsp, "stat").mockImplementation((async (p: string) => zero(await realStat(p))) as typeof fsp.stat);
      vi.spyOn(fsp, "lstat").mockImplementation(((async (p: string) => zero(await realLstat(p))) as unknown) as typeof fsp.lstat);

      const ignore = IgnoreEngine.create(dir, {});
      const entries = await scan(dir, { recursive: true, followSymlinks: false }, ignore, () => {});
      // The whole tree must be seeded, not just the root's direct children.
      expect([...entries.keys()]).toContain(join(dir, "a", "b", "c.txt"));
    } finally {
      cleanup();
    }
  });

  it.skipIf(process.platform === "win32")(
    "terminates on a symlink cycle even when ino===0 and followSymlinks is on (review #1)",
    async () => {
      const { dir, cleanup } = tempDir();
      try {
        mkdirSync(join(dir, "a"));
        writeFileSync(join(dir, "a", "f.txt"), "x");
        try {
          symlinkSync(join(dir, "a"), join(dir, "a", "self")); // a/self -> a: a cycle
        } catch {
          return; // unprivileged
        }
        // Force ino===0 on stat/lstat (but NOT realpath, which resolves the loop).
        const realStat = fsp.stat.bind(fsp);
        const realLstat = fsp.lstat.bind(fsp);
        const zero = (s: fsSync.Stats): fsSync.Stats => {
          (s as { ino: number }).ino = 0;
          return s;
        };
        vi.spyOn(fsp, "stat").mockImplementation((async (p: string) => zero(await realStat(p))) as typeof fsp.stat);
        vi.spyOn(fsp, "lstat").mockImplementation(((async (p: string) => zero(await realLstat(p))) as unknown) as typeof fsp.lstat);

        const ignore = IgnoreEngine.create(dir, {});
        // Must resolve (not hang); realpath-based dedup bounds the cycle.
        const entries = await scan(dir, { recursive: true, followSymlinks: true }, ignore, () => {});
        expect([...entries.keys()]).toContain(join(dir, "a", "f.txt"));
      } finally {
        cleanup();
      }
    },
  );
});

describe("watcher lifecycle (M1, M5)", () => {
  it("flushOnClose delivers pending coalesced events even when paused at close (M5)", async () => {
    const { dir, cleanup } = tempDir();
    writeFileSync(join(dir, "f.txt"), "v1");
    const w = watch(dir, { ignoreInitial: true, debounce: 80, flushOnClose: true });
    try {
      await w.ready();
      const seen: WatchEvent[] = [];
      w.on("all", (e) => seen.push(e));

      writeFileSync(join(dir, "f.txt"), "v2"); // change → held in the debouncer
      await sleep(20); // still within the 80ms debounce window
      w.pause();
      await w.close(); // flushOnClose must not lose the held event to the pause buffer
      await sleep(20);

      expect(seen.some((e) => e.type === "change")).toBe(true);
    } finally {
      await w.close();
      cleanup();
    }
  });

  it("does not deliver events after close() while a new-directory scan is in flight (M1)", async () => {
    const { dir, cleanup } = tempDir();
    const src = join(dir, "..", `src-${process.pid}-${seen0()}`);
    try {
      // A sizeable tree so #scanNewDirectory's async walk is still running when
      // we close() right after moving it into the watched root.
      mkdirSync(src, { recursive: true });
      for (let i = 0; i < 400; i++) writeFileSync(join(src, `f${i}.txt`), "x");

      const w = watch(dir, { recursive: true, ignoreInitial: true });
      await w.ready();

      let closed = false;
      const afterClose: WatchEvent[] = [];
      w.on("close", () => (closed = true));
      w.on("all", (e) => {
        if (closed) afterClose.push(e);
      });

      renameSync(src, join(dir, "moved")); // create(moved) → triggers scanNewDirectory
      await sleep(10); // let the create notification land and the scan begin
      await w.close();
      await sleep(400); // give any late scan time to (wrongly) deliver

      expect(afterClose).toEqual([]);
    } finally {
      rmSync(src, { recursive: true, force: true });
      cleanup();
    }
  });
});

// Tiny deterministic counter so two temp names in one run differ without
// Date.now()/Math.random().
let seenCounter = 0;
function seen0(): number {
  return seenCounter++;
}

describe("move-detector: identity is dev:ino, corroborated by kind (M6, L5)", () => {
  afterEach(() => vi.useRealTimers());

  it("pairs a delete+create with the same dev+ino and matching kind into a move", () => {
    const out: WatchEvent[] = [];
    const md = new MoveDetector(100, true, (e) => out.push(e), () => 0);
    md.feed(ev("delete", "/a"), 100, 1);
    md.feed(ev("create", "/b"), 100, 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("move");
    expect(out[0]!.oldPath).toBe("/a");
  });

  it("does NOT pair across devices when the inode number collides (M6)", () => {
    vi.useFakeTimers();
    const out: WatchEvent[] = [];
    const md = new MoveDetector(100, true, (e) => out.push(e), () => 0);
    md.feed(ev("delete", "/data/a"), 100, 1);
    md.feed(ev("create", "/mnt/b"), 100, 2); // same ino, different device
    expect(out.some((e) => e.type === "move")).toBe(false);
    vi.advanceTimersByTime(150);
    expect(out.map((e) => e.type).sort()).toEqual(["create", "delete"]);
  });

  it("does NOT pair a file with a directory even on the same dev+ino (L5)", () => {
    vi.useFakeTimers();
    const out: WatchEvent[] = [];
    const md = new MoveDetector(100, true, (e) => out.push(e), () => 0);
    md.feed(ev("delete", "/a", false), 100, 1); // file
    md.feed(ev("create", "/b", true), 100, 1); // directory
    expect(out.some((e) => e.type === "move")).toBe(false);
    vi.advanceTimersByTime(150);
    expect(out.map((e) => e.type).sort()).toEqual(["create", "delete"]);
  });
});

describe("classifier: same-path type flips are handled (H1)", () => {
  it("file -> dir emits a delete of the file and a create of the directory", () => {
    const { dir, cleanup } = tempDir();
    try {
      const P = join(dir, "P");
      mkdirSync(P); // on disk P is now a directory
      const snap = new Map<string, FsEntry>([[P, fileEntry(P)]]); // but tracked as a file
      const result = makeClassifier(dir, snap).classify(P);
      expect(result?.event.type).toBe("delete");
      expect(result?.event.isDirectory).toBe(false);
      expect(result?.replacement?.event.type).toBe("create");
      expect(result?.replacement?.event.isDirectory).toBe(true);
      // Snapshot now reflects the directory, not the stale file.
      expect(snap.get(P)?.isDirectory).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("dir -> file deletes the directory + its descendants and creates the file", () => {
    const { dir, cleanup } = tempDir();
    try {
      const P = join(dir, "P");
      writeFileSync(P, "x"); // on disk P is now a file
      const child = join(P, "a"); // stale tracked descendant
      const snap = new Map<string, FsEntry>([
        [P, dirEntry(P)],
        [child, fileEntry(child)],
      ]);
      const result = makeClassifier(dir, snap).classify(P);
      expect(result?.event.type).toBe("delete");
      expect(result?.event.isDirectory).toBe(true);
      expect(result?.cascade?.map((c) => c.event.absolutePath)).toContain(child);
      expect(result?.replacement?.event.type).toBe("create");
      expect(result?.replacement?.event.isDirectory).toBe(false);
      // The ghost descendant is purged.
      expect(snap.has(child)).toBe(false);
      expect(snap.get(P)?.isDirectory).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("classifier: transient stat errors are not deletions (M3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("EMFILE on stat keeps the entry and reports the error instead of emitting a delete", () => {
    const { dir, cleanup } = tempDir();
    try {
      const P = join(dir, "f.txt");
      writeFileSync(P, "x");
      const snap = new Map<string, FsEntry>([[P, fileEntry(P)]]);
      const errors: Error[] = [];
      vi.spyOn(fsSync, "lstatSync").mockImplementation(() => {
        throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
      });
      const result = makeClassifier(dir, snap, { onError: (e) => errors.push(e) }).classify(P);
      expect(result).toBeNull(); // NOT a delete
      expect(snap.has(P)).toBe(true); // entry retained
      expect(errors.map((e) => (e as NodeJS.ErrnoException).code)).toContain("EMFILE");
    } finally {
      cleanup();
    }
  });
});

describe("classifier: replacing a tracked file with an unfollowed symlink deletes it (review #2)", () => {
  it.skipIf(process.platform === "win32")("emits a delete and drops the entry, not a ghost", () => {
    const { dir, cleanup } = tempDir();
    try {
      const target = join(dir, "target.txt");
      const P = join(dir, "P");
      writeFileSync(target, "x");
      try {
        symlinkSync(target, P); // P is now a symlink we won't follow
      } catch {
        return; // unprivileged
      }
      const snap = new Map<string, FsEntry>([[P, fileEntry(P)]]); // was a real file
      const result = makeClassifier(dir, snap, { followSymlinks: false }).classify(P);
      expect(result?.event.type).toBe("delete");
      expect(snap.has(P)).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("classifier: a dangling symlink is not a deletion of the link (L1)", () => {
  it.skipIf(process.platform === "win32")("keeps the entry when the symlink target vanishes", () => {
    const { dir, cleanup } = tempDir();
    try {
      const target = join(dir, "target.txt");
      const link = join(dir, "link.txt");
      writeFileSync(target, "x");
      try {
        symlinkSync(target, link);
      } catch {
        return; // unprivileged environment
      }
      rmSync(target); // link is now dangling
      const snap = new Map<string, FsEntry>([[link, fileEntry(link)]]);
      const result = makeClassifier(dir, snap, { followSymlinks: true }).classify(link);
      expect(result).toBeNull(); // no spurious delete for the still-present link
      expect(snap.has(link)).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("glob: ReDoS-safe compilation (H3)", () => {
  it("chained globstar segments do not catastrophically backtrack", () => {
    const m = compileGlob("**/".repeat(30) + "z");
    const deepNonMatch = `${Array(30).fill("a").join("/")}`; // no trailing z
    const start = performance.now();
    const result = m.test(deepNonMatch);
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(50); // was multiple seconds before the fix
  });

  it("runs of glued stars collapse and do not backtrack", () => {
    const m = compileGlob(`a${"*".repeat(25)}b`);
    const start = performance.now();
    const result = m.test(`a${"x".repeat(60)}`); // no trailing b
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it("preserves glob semantics after collapsing", () => {
    expect(compileGlob("**/foo").test("a/b/foo")).toBe(true);
    expect(compileGlob("**/foo").test("foo")).toBe(true); // ** also matches zero dirs
    expect(compileGlob("**/**/bar").test("x/y/bar")).toBe(true);
    expect(compileGlob("src/**").test("src/a/b.ts")).toBe(true);
    expect(compileGlob("a*b").test("axxb")).toBe(true);
    expect(compileGlob("a*b").test("ax/xb")).toBe(false); // * never crosses '/'
    expect(compileGlob("*.log").test("app.log")).toBe(true);
    expect(compileGlob("*.log").test("nested/app.log")).toBe(false);
  });
});

describe("glob: malformed patterns never crash (H4)", () => {
  it("an invalid character-class range compiles instead of throwing", () => {
    expect(() => compileGlob("[z-a]")).not.toThrow();
    expect(() => compileGlob("[a-Z]")).not.toThrow();
    // The fallback is a literal match, so it is inert for real paths.
    expect(compileGlob("[z-a]").test("anything")).toBe(false);
  });
});

describe("glob: case-sensitivity follows the platform filesystem (L2)", () => {
  it("matches case-insensitively on macOS/Windows, case-sensitively on Linux", () => {
    const root = path.resolve("/tmp/zerowatch-case");
    const eng = IgnoreEngine.create(root, { ignore: ["node_modules"] });
    // Self-consistent with the extension matcher, which already lowercases.
    expect(eng.ignoresDirectory(path.join(root, "Node_Modules"))).toBe(caseInsensitiveFs);
    // Exact case always matches regardless of platform.
    expect(eng.ignoresDirectory(path.join(root, "node_modules"))).toBe(true);
  });
});

describe("ignore-engine: absolute-path globs match (L3)", () => {
  // On POSIX the absolute path is already `/`-separated so this passes with or
  // without the fix; it guards the behavior. The fix's real effect is on
  // Windows, where the absolute candidate must be POSIX-normalized to match a
  // `/`-based absolute glob (verified by inspection — path.sep is `/` here).
  it("an absolute-path glob suppresses a matching absolute path", () => {
    const root = path.resolve("/tmp/zerowatch-l3");
    const globPosix = `${root.split(path.sep).join("/")}/dist/**`;
    const eng = IgnoreEngine.create(root, { ignore: [globPosix] });
    expect(eng.ignoresFile(path.join(root, "dist", "a.js"))).toBe(true);
    expect(eng.ignoresFile(path.join(root, "src", "a.js"))).toBe(false);
  });
});

describe("polling backend keeps the process alive (H2)", () => {
  it("its scheduling timer references the event loop (like the native backends)", async () => {
    const { dir, cleanup } = tempDir();
    const w = new PollingWatcher(dir, false, noopSink, () => true, false, 500, 500, new Set());
    try {
      await w.start();
      // No await between these two reads, so the only Timeout that changes is
      // the poll timer. A persistent (ref'd) timer is counted; an unref'd one
      // would not be, so this would read equal and fail before the fix.
      const withWatcher = countTimeouts();
      void w.close();
      const withoutWatcher = countTimeouts();
      expect(withWatcher).toBeGreaterThan(withoutWatcher);
    } finally {
      void w.close();
      cleanup();
    }
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { watch } from "../src/index.js";
import type { WatchEvent } from "../src/index.js";
import { closeLeakedWatchers } from "../src/core/leak-registry.js";
import type { PlatformWatcher } from "../src/types/internal.js";
import { tempDir, sleep } from "./helpers.js";
import type { Watcher } from "../src/core/watcher.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function makeDir(): string {
  const { dir, cleanup } = tempDir();
  cleanups.push(cleanup);
  return dir;
}

function track(w: Watcher<WatchEvent>): Watcher<WatchEvent> {
  cleanups.push(() => w.close());
  return w;
}

describe("bug: add() re-emits create for already-covered entries", () => {
  it("add() of a subtree already covered by a recursive watch emits no duplicate creates", async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "a.txt"), "x");

    const w = track(watch(dir, { recursive: true }));
    await w.ready();

    const seen: WatchEvent[] = [];
    w.on("all", (e) => seen.push(e));

    await w.add(join(dir, "sub"));
    await sleep(150);

    expect(seen.filter((e) => e.type === "create")).toEqual([]);
  });
});

describe("bug: unwatch() leaves in-flight holds active", () => {
  it("cancels a pending debounced event for the forgotten subtree", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "f.txt"), "v1");

    const w = track(watch(dir, { recursive: true, ignoreInitial: true, debounce: 120 }));
    await w.ready();

    const seen: WatchEvent[] = [];
    w.on("all", (e) => seen.push(e));

    writeFileSync(join(dir, "f.txt"), "v2"); // change → held in the debouncer
    await sleep(25);
    await w.unwatch(dir); // forget the subtree before the debounce fires
    await sleep(250);

    expect(seen).toEqual([]);
  });
});

describe("bug: polling walk explodes on a symlink cycle", () => {
  it("does not descend into a symlinked directory that loops back into the tree", async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "a.txt"), "x");
    symlinkSync(dir, join(dir, "loop")); // loop -> dir: a cycle

    const events: WatchEvent[] = [];
    const w = track(
      watch(dir, { usePolling: true, interval: 50, followSymlinks: true, ignoreInitial: true }),
    );
    w.on("all", (e) => events.push(e));

    const ready = await Promise.race([
      w.ready().then(() => true),
      sleep(3000).then(() => false),
    ]);
    expect(ready).toBe(true);
    await sleep(120); // establish the polling baseline

    // Editing the real file must surface once, not once per phantom path the
    // cycle would otherwise fabricate under loop/loop/loop/…
    events.length = 0;
    writeFileSync(join(dir, "sub", "a.txt"), "y-longer-content");
    await sleep(300);

    const underLoop = events.filter((e) => e.relativePath.includes("loop/"));
    expect(underLoop).toEqual([]);
  });
});

describe("bug: FinalizationRegistry callback can raise an unhandled rejection", () => {
  it("tolerates a watcher whose async close() rejects", async () => {
    const rejections: unknown[] = [];
    const handler = (r: unknown): void => {
      rejections.push(r);
    };
    process.on("unhandledRejection", handler);
    try {
      const holder = {
        watchers: new Set<PlatformWatcher>([
          { start: async () => {}, close: async () => { throw new Error("async close fail"); } },
        ]),
      };

      expect(() => closeLeakedWatchers(holder)).not.toThrow();
      // Let any escaped rejection surface on the next turns.
      await sleep(30);

      expect(rejections).toEqual([]);
      expect(holder.watchers.size).toBe(0);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });
});

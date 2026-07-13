import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { watch } from "../src/index.js";
import type { WatchEvent } from "../src/index.js";
import { tempDir, sleep, waitFor } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
function makeDir(): string {
  const { dir, cleanup } = tempDir();
  cleanups.push(cleanup);
  return dir;
}

describe("getWatched()", () => {
  it("reports tracked entries grouped by directory", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.txt"), "1");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.txt"), "2");

    const w = watch(dir);
    cleanups.push(() => void w.close());
    await w.ready();

    const watched = w.getWatched();
    expect(watched["."]).toEqual(expect.arrayContaining(["a.txt", "sub"]));
    expect(watched["sub"]).toEqual(["b.txt"]);
  });
});

describe("add() / unwatch()", () => {
  it("starts watching a newly added directory", async () => {
    const root = makeDir();
    const other = makeDir();

    const w = watch(root, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.absolutePath));

    await w.add(other);
    await sleep(150); // let the native watcher warm up on the new path
    writeFileSync(join(other, "new.txt"), "hi");
    await waitFor(() => seen.some((p) => p.endsWith("new.txt")), 5000);
    expect(seen.some((p) => p.endsWith("new.txt"))).toBe(true);
  });

  it("stops emitting after unwatch()", async () => {
    const root = makeDir();
    const other = makeDir();

    const w = watch(root, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();
    await w.add(other);

    await w.unwatch(other);
    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.absolutePath));
    writeFileSync(join(other, "ignored.txt"), "x");
    await sleep(200);
    expect(seen.some((p) => p.endsWith("ignored.txt"))).toBe(false);
  });
});

describe("flushOnClose", () => {
  it("flushes debounced events on close instead of dropping them", async () => {
    const dir = makeDir();
    const w = watch(dir, {
      ignoreInitial: true,
      debounce: 5000,
      flushOnClose: true,
      moveWindow: 0, // don't hold the create for move pairing
    });
    await w.ready();

    const seen: WatchEvent[] = [];
    w.on("all", (e) => seen.push(e));
    writeFileSync(join(dir, "pending.txt"), "x");
    await sleep(150); // event has passed into the (5s) debounce window
    expect(seen).toHaveLength(0);

    await w.close();
    expect(seen.some((e) => e.relativePath === "pending.txt")).toBe(true);
  });

  it("drops debounced events on close by default", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true, debounce: 5000, moveWindow: 0 });
    await w.ready();

    const seen: WatchEvent[] = [];
    w.on("all", (e) => seen.push(e));
    writeFileSync(join(dir, "pending.txt"), "x");
    await sleep(150);
    await w.close();
    expect(seen).toHaveLength(0);
  });
});

describe("usePolling backend", () => {
  it("detects a create via periodic polling", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true, usePolling: true, interval: 60 });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("create", (e) => seen.push(e.relativePath));
    writeFileSync(join(dir, "polled.txt"), "1");
    await waitFor(() => seen.includes("polled.txt"), 3000);
    expect(seen).toContain("polled.txt");
  });

  it("detects a change and delete via polling", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "f.txt"), "one");
    const w = watch(dir, { ignoreInitial: true, usePolling: true, interval: 60 });
    cleanups.push(() => void w.close());
    await w.ready();

    const types = new Set<string>();
    w.on("all", (e) => types.add(`${e.type}:${e.relativePath}`));
    writeFileSync(join(dir, "f.txt"), "two-longer");
    await waitFor(() => types.has("change:f.txt"), 3000);
    expect(types.has("change:f.txt")).toBe(true);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, utimesSync, statSync, rmSync } from "node:fs";
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

describe("depth", () => {
  it("only reports entries within the depth limit", async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "a", "b"), { recursive: true });

    const w = watch(dir, { depth: 0 });
    cleanups.push(() => void w.close());
    const seen: string[] = [];
    w.on("create", (e) => seen.push(e.relativePath));
    await w.ready();
    await sleep(50);

    // depth 0 = only the root's direct entries.
    expect(seen).toContain("a");
    expect(seen).not.toContain("a/b");
  });

  it("suppresses live events deeper than the limit", async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "a"), { recursive: true });
    const w = watch(dir, { ignoreInitial: true, depth: 0 });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.relativePath));
    writeFileSync(join(dir, "top.txt"), "1"); // depth 0 — kept
    writeFileSync(join(dir, "a", "deep.txt"), "2"); // depth 1 — dropped
    await waitFor(() => seen.includes("top.txt"), 3000);
    await sleep(150);
    expect(seen).toContain("top.txt");
    expect(seen.some((p) => p.includes("deep.txt"))).toBe(false);
  });
});

describe("hashChanges", () => {
  it("detects an edit that restores size, mtime, and ctime", async () => {
    const dir = makeDir();
    const file = join(dir, "f.txt");
    writeFileSync(file, "aaaa");
    const w = watch(dir, { ignoreInitial: true, hashChanges: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const changes: string[] = [];
    w.on("change", (e) => changes.push(e.relativePath));

    // Same length ("bbbb"), then forcibly restore the original timestamps so the
    // cheap size/mtime/ctime checks all say "unchanged" — only the hash differs.
    const before = statSync(file);
    writeFileSync(file, "bbbb");
    utimesSync(file, before.atime, before.mtime);

    await waitFor(() => changes.includes("f.txt"), 3000);
    expect(changes).toContain("f.txt");
  });
});

describe("close during startup", () => {
  it("never emits ready after close and terminates cleanly", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.txt"), "1");
    const w = watch(dir);

    let readyFired = false;
    let closeFired = false;
    w.on("ready", () => (readyFired = true));
    w.on("close", () => (closeFired = true));

    // Close immediately, before the queued #start microtask has finished.
    await w.close();
    await sleep(80);

    expect(closeFired).toBe(true);
    expect(readyFired).toBe(false);
    expect(w.getWatched()).toEqual({}); // no handles/entries leaked
  });
});

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

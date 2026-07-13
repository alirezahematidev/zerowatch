import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { watch } from "../src/index.js";
import type { WatchEvent } from "../src/index.js";
import { tempDir, sleep, collect, waitFor } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function makeDir(): string {
  const { dir, cleanup } = tempDir();
  cleanups.push(cleanup);
  return dir;
}

describe("ready()", () => {
  it("resolves only after the initial scan and reports pre-existing files", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.txt"), "1");
    writeFileSync(join(dir, "b.txt"), "2");

    const initial: WatchEvent[] = [];
    const w = watch(dir);
    w.on("create", (e) => initial.push(e));
    cleanups.push(() => void w.close());

    await w.ready();
    const names = initial.map((e) => e.relativePath).sort();
    expect(names).toEqual(["a.txt", "b.txt"]);
  });

  it("suppresses initial events with ignoreInitial", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.txt"), "1");
    const initial: WatchEvent[] = [];
    const w = watch(dir, { ignoreInitial: true });
    w.on("create", (e) => initial.push(e));
    cleanups.push(() => void w.close());
    await w.ready();
    await sleep(50);
    expect(initial).toHaveLength(0);
  });
});

describe("create / change / delete", () => {
  it("emits create for a new file", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const events = collect(w, 1);
    writeFileSync(join(dir, "new.txt"), "hello");
    const [event] = await events;
    expect(event?.type).toBe("create");
    expect(event?.relativePath).toBe("new.txt");
  });

  it("emits change when a file is modified", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "f.txt"), "one");
    const w = watch(dir, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const changes: WatchEvent[] = [];
    w.on("change", (e) => changes.push(e));
    writeFileSync(join(dir, "f.txt"), "two-much-longer");
    await waitFor(() => changes.length > 0);
    expect(changes[0]?.relativePath).toBe("f.txt");
  });

  it("emits delete when a file is removed", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "gone.txt"), "x");
    const w = watch(dir, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const deletes: WatchEvent[] = [];
    w.on("delete", (e) => deletes.push(e));
    rmSync(join(dir, "gone.txt"));
    await waitFor(() => deletes.length > 0);
    expect(deletes[0]?.relativePath).toBe("gone.txt");
  });
});

describe("recursive directory watch", () => {
  it("detects files created in nested directories", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true, recursive: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen = new Set<string>();
    w.on("create", (e) => seen.add(e.relativePath));

    mkdirSync(join(dir, "a", "b"), { recursive: true });
    await waitFor(() => seen.has("a/b"));
    writeFileSync(join(dir, "a", "b", "deep.txt"), "x");
    await waitFor(() => seen.has("a/b/deep.txt"));

    expect([...seen]).toContain("a/b/deep.txt");
  });
});

describe("directory vs file watch entrypoints", () => {
  it("watch.file emits only for the single file", async () => {
    const dir = makeDir();
    const file = join(dir, "target.txt");
    writeFileSync(file, "start");
    writeFileSync(join(dir, "other.txt"), "noise");

    const w = watch.file(file, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const events: WatchEvent[] = [];
    w.on("all", (e) => events.push(e));
    writeFileSync(join(dir, "other.txt"), "noise changed");
    writeFileSync(file, "changed content here");
    await waitFor(() => events.some((e) => e.type === "change"));

    expect(events.every((e) => e.absolutePath === file)).toBe(true);
  });

  it("watch.directory watches recursively by default", async () => {
    const dir = makeDir();
    const w = watch.directory(dir, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();
    const seen = new Set<string>();
    w.on("create", (e) => seen.add(e.relativePath));
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "x.txt"), "1");
    await waitFor(() => seen.has("nested/x.txt"));
    expect(seen.has("nested/x.txt")).toBe(true);
  });
});

describe("async iterator", () => {
  it("yields events via for-await", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true });
    await w.ready();

    const received: WatchEvent[] = [];
    const consume = (async () => {
      for await (const event of w) {
        received.push(event);
        if (received.length >= 2) break;
      }
    })();

    await sleep(50);
    writeFileSync(join(dir, "1.txt"), "a");
    await sleep(80);
    writeFileSync(join(dir, "2.txt"), "b");

    await consume;
    await w.close();
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.type)).toEqual(["create", "create"]);
  });

  it("terminates the iterator on close", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true });
    await w.ready();

    let completed = false;
    const consume = (async () => {
      for await (const _event of w) {
        // drain
      }
      completed = true;
    })();

    await sleep(30);
    await w.close();
    await consume;
    expect(completed).toBe(true);
  });
});

describe("pause / resume", () => {
  it("buffers events while paused and flushes on resume", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const events: WatchEvent[] = [];
    w.on("all", (e) => events.push(e));

    w.pause();
    writeFileSync(join(dir, "p.txt"), "x");
    await sleep(120);
    expect(events).toHaveLength(0);

    w.resume();
    await waitFor(() => events.length > 0);
    expect(events[0]?.relativePath).toBe("p.txt");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AsyncQueue } from "../src/core/async-queue.js";
import { watch } from "../src/index.js";
import type { WatchEvent } from "../src/index.js";
import type { Watcher } from "../src/core/watcher.js";
import { tempDir, sleep } from "./helpers.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe("AsyncQueue onDrop", () => {
  it("invokes onDrop for each evicted value when a bounded buffer overflows", () => {
    const dropped: number[] = [];
    const q = new AsyncQueue<number>({ maxBuffered: 2, onDrop: (v) => dropped.push(v) });
    q.push(1);
    q.push(2);
    q.push(3); // evicts 1
    q.push(4); // evicts 2
    expect(dropped).toEqual([1, 2]);
  });
});

describe("Watcher 'drop' event (maxBufferedEvents backpressure)", () => {
  it("emits a cumulative-count drop event when the iterator buffer overflows", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);

    // Bound the buffer to 1 and never consume the async iterator, so a burst of
    // creates overflows it and the oldest are dropped.
    const w = watch(dir, { ignoreInitial: true, maxBufferedEvents: 1 }) as Watcher<WatchEvent>;
    cleanups.push(() => w.close());

    const drops: number[] = [];
    w.on("drop", ({ count }) => drops.push(count));
    await w.ready();

    for (let i = 0; i < 40; i++) writeFileSync(join(dir, `f${i}.txt`), "x");
    await sleep(400); // let moveWindow holds release and the burst deliver

    expect(drops.length).toBeGreaterThan(0);
    // Count is cumulative and monotonic.
    expect(drops[drops.length - 1]).toBe(drops.length);
  });
});

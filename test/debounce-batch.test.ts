import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
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

describe("debounce (integration)", () => {
  it("coalesces a rapid burst of writes into one change", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "f.txt"), "0");
    const w = watch(dir, { ignoreInitial: true, debounce: 120 });
    cleanups.push(() => void w.close());
    await w.ready();

    const changes: WatchEvent[] = [];
    w.on("change", (e) => changes.push(e));

    for (let i = 1; i <= 6; i++) {
      writeFileSync(join(dir, "f.txt"), `content-${i}-padding`);
      await sleep(15);
    }
    await sleep(250);

    // Without debounce this would be many events; debounced it collapses.
    expect(changes.length).toBeLessThanOrEqual(2);
    expect(changes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("batch (integration)", () => {
  it("yields arrays of events from the async iterator", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true, batch: 150 });
    cleanups.push(() => void w.close());
    await w.ready();

    const batches: WatchEvent[][] = [];
    const consume = (async () => {
      for await (const batch of w) {
        batches.push(batch);
        if (batches.flat().length >= 3) break;
      }
    })();

    await sleep(30);
    writeFileSync(join(dir, "a.txt"), "1");
    writeFileSync(join(dir, "b.txt"), "2");
    writeFileSync(join(dir, "c.txt"), "3");

    await consume;
    await w.close();

    expect(Array.isArray(batches[0])).toBe(true);
    expect(batches.flat().length).toBeGreaterThanOrEqual(3);
    // A single window should group multiple events together.
    expect(Math.max(...batches.map((b) => b.length))).toBeGreaterThan(1);
  });

  it("also fires the typed `batch` event", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true, batch: 120 });
    cleanups.push(() => void w.close());
    await w.ready();

    const batches: WatchEvent[][] = [];
    w.on("batch", (events) => batches.push(events));
    writeFileSync(join(dir, "x.txt"), "1");
    writeFileSync(join(dir, "y.txt"), "2");
    await waitFor(() => batches.length > 0, 2000);

    expect(batches[0]!.length).toBeGreaterThanOrEqual(1);
  });
});

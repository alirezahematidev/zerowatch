import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, renameSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { watch, inodeMoveDetectionSupported } from "../src/index.js";
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

describe("move detection", () => {
  it.runIf(inodeMoveDetectionSupported)(
    "reports a rename as a single move with oldPath",
    async () => {
      const dir = makeDir();
      writeFileSync(join(dir, "from.txt"), "content");
      const w = watch(dir, { ignoreInitial: true });
      cleanups.push(() => void w.close());
      await w.ready();

      const events: WatchEvent[] = [];
      w.on("all", (e) => events.push(e));
      renameSync(join(dir, "from.txt"), join(dir, "to.txt"));
      await waitFor(() => events.some((e) => e.type === "move"), 2000);

      const move = events.find((e) => e.type === "move");
      expect(move).toBeDefined();
      expect(move?.relativePath).toBe("to.txt");
      expect(move?.oldPath).toContain("from.txt");
      // Should not also see a bare delete+create for the same rename.
      expect(events.filter((e) => e.type === "delete")).toHaveLength(0);
    },
  );

  it("falls back to delete/create when the pair cannot be correlated", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.txt"), "1");
    const w = watch(dir, { ignoreInitial: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const types = new Set<string>();
    w.on("all", (e) => types.add(e.type));
    // Two unrelated operations far apart never pair into a move.
    writeFileSync(join(dir, "b.txt"), "2");
    await sleep(300);
    expect(types.has("create")).toBe(true);
    expect(types.has("move")).toBe(false);
  });
});

describe("awaitWrite (write stability)", () => {
  it("delays the event until the file stops growing", async () => {
    const dir = makeDir();
    const w = watch(dir, {
      ignoreInitial: true,
      awaitWrite: { stabilityThreshold: 150, pollInterval: 40 },
    });
    cleanups.push(() => void w.close());
    await w.ready();

    let firstEventAt = 0;
    const start = Date.now();
    w.on("create", () => {
      if (firstEventAt === 0) firstEventAt = Date.now() - start;
    });

    // Simulate a slow write: open a stream and append over ~250ms.
    const file = join(dir, "big.bin");
    const stream = createWriteStream(file);
    for (let i = 0; i < 5; i++) {
      stream.write(Buffer.alloc(1024, i));
      await sleep(50);
    }
    stream.end();

    await waitFor(() => firstEventAt > 0, 2000);
    // The event must arrive only after writing settled (~250ms), not at t≈0.
    expect(firstEventAt).toBeGreaterThan(150);
  });
});

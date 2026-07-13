import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ManualRecursiveWatcher } from "../src/platform/manual-recursive-watcher.js";
import type { RawFsEvent } from "../src/types/internal.js";
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

describe("ManualRecursiveWatcher (per-directory backend)", () => {
  it("emits raw events and grows/prunes watchers as directories appear and vanish", async () => {
    const root = makeDir();
    mkdirSync(join(root, "a"));

    const events: RawFsEvent[] = [];
    const w = new ManualRecursiveWatcher(
      root,
      true,
      { onEvent: (e) => events.push(e), onError: () => {} },
      () => true,
    );
    cleanups.push(() => void w.close());
    await w.start();
    await sleep(50);

    // A file in a pre-existing nested dir is covered.
    writeFileSync(join(root, "a", "f.txt"), "1");
    await waitFor(() => events.some((e) => e.absolutePath.endsWith("f.txt")), 3000);
    expect(events.some((e) => e.absolutePath.endsWith("f.txt"))).toBe(true);

    // A brand-new nested dir gets a watcher via #reconcile, so its files fire too.
    mkdirSync(join(root, "b", "c"), { recursive: true });
    await sleep(150);
    writeFileSync(join(root, "b", "c", "deep.txt"), "2");
    await waitFor(() => events.some((e) => e.absolutePath.endsWith("deep.txt")), 3000);
    expect(events.some((e) => e.absolutePath.endsWith("deep.txt"))).toBe(true);

    // Removing a subtree prunes its watchers without throwing.
    rmSync(join(root, "b"), { recursive: true, force: true });
    await sleep(150);
    await w.close();
  });
});

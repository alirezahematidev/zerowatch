import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WatchEvent } from "../src/index.js";
import type { Watcher } from "../src/core/watcher.js";

/** Create a fresh temp directory and return it plus a cleanup function. */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "zerowatch-test-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collect events from a watcher's `all` listener until `count` are gathered or
 * `timeout` elapses, then resolve with whatever was collected. Never rejects,
 * so tests assert on the collected set explicitly.
 */
export function collect(watcher: Watcher<WatchEvent>, count: number, timeout = 3000): Promise<WatchEvent[]> {
  return new Promise((resolve) => {
    const events: WatchEvent[] = [];
    const done = (): void => {
      clearTimeout(timer);
      watcher.off("all", onEvent);
      resolve(events);
    };
    const onEvent = (event: WatchEvent): void => {
      events.push(event);
      if (events.length >= count) done();
    };
    const timer = setTimeout(done, timeout);
    watcher.on("all", onEvent);
  });
}

/** Poll `predicate` until it returns true or the timeout elapses. */
export async function waitFor(predicate: () => boolean, timeout = 3000, interval = 20): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await sleep(interval);
  }
  return predicate();
}

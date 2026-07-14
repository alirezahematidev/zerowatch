import type { PlatformWatcher } from "../types/internal.js";

/**
 * A back-reference-free holder for a watcher's platform handles.
 *
 * The {@link leakRegistry} holds this object strongly, so it MUST NOT reference
 * the owning `Watcher` (directly or transitively) — otherwise the `Watcher`
 * would be pinned in memory and the registry could never fire. Because the
 * platform adapters reference their sink weakly (see `WeakSink`), holding the
 * adapters here does not pin the `Watcher`.
 */
export interface WatcherHolder {
  readonly watchers: Set<PlatformWatcher>;
}

/** Close every platform handle in `holder`, swallowing errors, then clear it. */
export function closeLeakedWatchers(holder: WatcherHolder): void {
  for (const watcher of holder.watchers) {
    try {
      // close() may be async; swallow both synchronous throws and rejected
      // promises — a FinalizationRegistry callback must never throw, and an
      // unhandled rejection from here could crash a strict process.
      Promise.resolve(watcher.close()).catch(() => {});
    } catch {
      // A FinalizationRegistry callback must never throw.
    }
  }
  holder.watchers.clear();
}

/**
 * Backstop for a `Watcher` dropped without `close()`. When such a watcher is
 * garbage-collected, this closes any native `fs.watch` handles it left open.
 * Finalizers are not guaranteed to run — this is a safety net, not a substitute
 * for calling `close()`.
 */
export const leakRegistry = new FinalizationRegistry<WatcherHolder>(closeLeakedWatchers);

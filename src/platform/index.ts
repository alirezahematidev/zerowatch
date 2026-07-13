import type {
  PlatformSink,
  PlatformWatcher,
  PlatformWatchTarget,
} from "../types/internal.js";
import { nativeRecursiveSupported } from "./capabilities.js";
import { FileWatcher } from "./file-watcher.js";
import { NativeRecursiveWatcher } from "./native-recursive-watcher.js";
import { ManualRecursiveWatcher } from "./manual-recursive-watcher.js";
import { PollingWatcher } from "./polling-watcher.js";

export { nativeRecursiveSupported, inodeMoveDetectionSupported } from "./capabilities.js";

/** Backend-selection knobs the core passes through from resolved options. */
export interface PlatformOptions {
  readonly usePolling: boolean;
  readonly interval: number;
}

/**
 * Select and construct the appropriate platform watcher for a target. This is
 * the single seam between platform-specific code and the watcher core; the core
 * never references a concrete adapter.
 *
 * @param shouldWatchDir predicate the manual/polling adapters use to avoid
 *   descending into ignored directories (unused by native adapters).
 */
export function createPlatformWatcher(
  target: PlatformWatchTarget,
  sink: PlatformSink,
  shouldWatchDir: (absolutePath: string) => boolean,
  options: PlatformOptions,
): PlatformWatcher {
  if (options.usePolling) {
    return new PollingWatcher(
      target.absolutePath,
      target.isDirectory && target.recursive,
      sink,
      shouldWatchDir,
      target.followSymlinks,
      options.interval,
    );
  }

  if (!target.isDirectory) {
    return new FileWatcher(target.absolutePath, sink);
  }

  if (target.recursive && nativeRecursiveSupported) {
    return new NativeRecursiveWatcher(target.absolutePath, sink);
  }

  return new ManualRecursiveWatcher(
    target.absolutePath,
    target.recursive,
    sink,
    shouldWatchDir,
  );
}

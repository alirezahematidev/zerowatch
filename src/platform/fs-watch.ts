import fs from "node:fs";
import path from "node:path";
import type { FSWatcher } from "node:fs";
import type { RawEventKind } from "../types/internal.js";

/** Callback shape used by the low-level watch helper. */
export type FsWatchListener = (kind: RawEventKind, absolutePath: string) => void;

/**
 * Wrap `fs.watch` with uniform error handling and absolute-path resolution.
 *
 * `baseDir` is the directory (or file's parent) being watched; `filename` from
 * the raw event is resolved against it. When `filename` is null (which some
 * platforms do for the watched entry itself) the base path is reported.
 */
export function watchPath(
  target: string,
  baseDir: string,
  recursive: boolean,
  listener: FsWatchListener,
  onError: (error: Error) => void,
): FSWatcher {
  const watcher = fs.watch(target, { recursive, persistent: true });

  watcher.on("change", (eventType, filename) => {
    const name =
      typeof filename === "string"
        ? filename
        : filename instanceof Buffer
          ? filename.toString("utf8")
          : null;
    const absolutePath = name === null ? target : path.resolve(baseDir, name);
    listener(eventType === "rename" ? "rename" : "change", absolutePath);
  });

  watcher.on("error", (error) => {
    // EPERM on Windows when a watched dir is removed; treat as recoverable.
    onError(error);
  });

  return watcher;
}

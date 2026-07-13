import path from "node:path";
import type { FSWatcher } from "node:fs";
import type { PlatformSink, PlatformWatcher } from "../types/internal.js";
import { watchPath } from "./fs-watch.js";

/**
 * Watches a single file. `fs.watch` on a file reports `change` for content edits
 * and `rename` when the file is replaced or removed; the core interprets which
 * normalized event that becomes by consulting the filesystem.
 */
export class FileWatcher implements PlatformWatcher {
  readonly #absolutePath: string;
  readonly #sink: PlatformSink;
  #watcher: FSWatcher | null = null;

  constructor(absolutePath: string, sink: PlatformSink) {
    this.#absolutePath = absolutePath;
    this.#sink = sink;
  }

  start(): Promise<void> {
    try {
      this.#watcher = watchPath(
        this.#absolutePath,
        path.dirname(this.#absolutePath),
        false,
        (kind, absolutePath) => this.#sink.onEvent({ kind, absolutePath }),
        (error) => this.#sink.onError(error),
      );
    } catch (error) {
      this.#sink.onError(error as Error);
    }
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.#watcher?.close();
    this.#watcher = null;
    return Promise.resolve();
  }
}

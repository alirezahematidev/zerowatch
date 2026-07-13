import type { FSWatcher } from "node:fs";
import type { PlatformSink, PlatformWatcher } from "../types/internal.js";
import { watchPath } from "./fs-watch.js";

/**
 * Recursive directory watcher backed by a single native `fs.watch` handle
 * (`{ recursive: true }`). Used on platforms where the OS provides recursive
 * notifications — macOS and Windows. See {@link nativeRecursiveSupported}.
 */
export class NativeRecursiveWatcher implements PlatformWatcher {
  readonly #root: string;
  readonly #sink: PlatformSink;
  #watcher: FSWatcher | null = null;

  constructor(root: string, sink: PlatformSink) {
    this.#root = root;
    this.#sink = sink;
  }

  start(): Promise<void> {
    try {
      this.#watcher = watchPath(
        this.#root,
        this.#root,
        true,
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

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "node:fs";
import type {
  PlatformSink,
  PlatformWatcher,
  RawFsEvent,
} from "../types/internal.js";
import { watchPath } from "./fs-watch.js";

/**
 * Recursive directory watcher assembled from one `fs.watch` handle per
 * directory. Used where the OS lacks native recursive support (Linux) and for
 * non-recursive single-directory watching.
 *
 * As directories appear and disappear it grows and prunes its set of handles so
 * coverage stays correct without a native recursive API. A `shouldWatchDir`
 * predicate lets the core keep it out of ignored subtrees (e.g. `node_modules`).
 */
export class ManualRecursiveWatcher implements PlatformWatcher {
  readonly #root: string;
  readonly #recursive: boolean;
  readonly #sink: PlatformSink;
  readonly #shouldWatchDir: (absolutePath: string) => boolean;
  readonly #watchers = new Map<string, FSWatcher>();
  #closed = false;

  constructor(
    root: string,
    recursive: boolean,
    sink: PlatformSink,
    shouldWatchDir: (absolutePath: string) => boolean,
  ) {
    this.#root = root;
    this.#recursive = recursive;
    this.#sink = sink;
    this.#shouldWatchDir = shouldWatchDir;
  }

  async start(): Promise<void> {
    await this.#addDir(this.#root);
  }

  close(): Promise<void> {
    this.#closed = true;
    for (const watcher of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
    return Promise.resolve();
  }

  #handleRaw(event: RawFsEvent): void {
    if (this.#closed) return;
    this.#sink.onEvent(event);
    // Only `rename` can change the directory topology (add/remove a subdir).
    if (this.#recursive && event.kind === "rename") {
      void this.#reconcile(event.absolutePath);
    }
  }

  async #reconcile(absolutePath: string): Promise<void> {
    try {
      const stats = await fsp.stat(absolutePath);
      if (stats.isDirectory() && !this.#watchers.has(absolutePath)) {
        await this.#addDir(absolutePath);
      }
    } catch {
      // Path is gone — drop its watcher and any descendants' watchers.
      this.#removeSubtree(absolutePath);
    }
  }

  async #addDir(dir: string): Promise<void> {
    if (this.#closed || this.#watchers.has(dir)) return;
    if (dir !== this.#root && !this.#shouldWatchDir(dir)) return;

    try {
      const watcher = watchPath(
        dir,
        dir,
        false,
        (kind, absolutePath) => this.#handleRaw({ kind, absolutePath }),
        (error) => this.#sink.onError(error),
      );
      this.#watchers.set(dir, watcher);
    } catch (error) {
      this.#sink.onError(error as Error);
      return;
    }

    if (!this.#recursive) return;

    // Descend so pre-existing subdirectories are covered too.
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        await this.#addDir(path.join(dir, dirent.name));
      }
    }
  }

  #removeSubtree(absolutePath: string): void {
    const prefix = `${absolutePath}${path.sep}`;
    for (const [dir, watcher] of this.#watchers) {
      if (dir === absolutePath || dir.startsWith(prefix)) {
        watcher.close();
        this.#watchers.delete(dir);
      }
    }
  }
}

import fsp from "node:fs/promises";
import path from "node:path";
import { extname } from "../utils/paths.js";
import type { PlatformSink, PlatformWatcher } from "../types/internal.js";

interface PollEntry {
  mtimeMs: number;
  size: number;
}

/**
 * A backend that detects changes by periodically walking the tree and diffing
 * `stat` results, instead of subscribing to native `fs.watch` notifications.
 *
 * Slower and more CPU-hungry than the native backends, but reliable where
 * `fs.watch` is not — network filesystems (NFS/SMB), some Docker bind mounts,
 * and virtualized environments. It emits the same raw `rename`/`change`
 * notifications the native adapters do; the core classifier normalizes them.
 */
export class PollingWatcher implements PlatformWatcher {
  readonly #root: string;
  readonly #recursive: boolean;
  readonly #sink: PlatformSink;
  readonly #shouldWatchDir: (absolutePath: string) => boolean;
  readonly #followSymlinks: boolean;
  readonly #interval: number;
  readonly #binaryExtensions: Set<string>;
  /** How many base ticks between full re-stats of binary files (>= 1). */
  readonly #binaryEvery: number;
  #tickCount = 0;
  #known = new Map<string, PollEntry>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;
  #polling = false;

  constructor(
    root: string,
    recursive: boolean,
    sink: PlatformSink,
    shouldWatchDir: (absolutePath: string) => boolean,
    followSymlinks: boolean,
    interval: number,
    binaryInterval: number,
    binaryExtensions: Set<string>,
  ) {
    this.#root = root;
    this.#recursive = recursive;
    this.#sink = sink;
    this.#shouldWatchDir = shouldWatchDir;
    this.#followSymlinks = followSymlinks;
    this.#interval = interval;
    this.#binaryExtensions = binaryExtensions;
    this.#binaryEvery = Math.max(1, Math.round(binaryInterval / interval));
  }

  async start(): Promise<void> {
    // Capture a baseline without emitting; the core seeds initial state itself.
    this.#known = await this.#walk(true);
    this.#schedule();
  }

  close(): Promise<void> {
    this.#closed = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    return Promise.resolve();
  }

  #schedule(): void {
    if (this.#closed) return;
    const timer = setTimeout(() => void this.#tick(), this.#interval);
    timer.unref?.();
    this.#timer = timer;
  }

  async #tick(): Promise<void> {
    if (this.#closed || this.#polling) {
      if (!this.#closed) this.#schedule();
      return;
    }
    this.#polling = true;
    try {
      // Re-stat binary files only every Nth tick (the binaryInterval cadence).
      const checkBinary = this.#tickCount % this.#binaryEvery === 0;
      this.#tickCount++;
      const next = await this.#walk(checkBinary);
      if (this.#closed) return;
      this.#diff(this.#known, next);
      this.#known = next;
    } catch (error) {
      this.#sink.onError(error as Error);
    } finally {
      this.#polling = false;
      this.#schedule();
    }
  }

  #diff(prev: Map<string, PollEntry>, next: Map<string, PollEntry>): void {
    for (const [abs, entry] of next) {
      const before = prev.get(abs);
      if (!before) {
        this.#sink.onEvent({ kind: "rename", absolutePath: abs });
      } else if (before.mtimeMs !== entry.mtimeMs || before.size !== entry.size) {
        this.#sink.onEvent({ kind: "change", absolutePath: abs });
      }
    }
    for (const abs of prev.keys()) {
      if (!next.has(abs)) {
        this.#sink.onEvent({ kind: "rename", absolutePath: abs });
      }
    }
  }

  async #walk(checkBinary: boolean): Promise<Map<string, PollEntry>> {
    const found = new Map<string, PollEntry>();
    const stack: string[] = [this.#root];
    const seenDirs = new Set<string>();

    while (stack.length > 0) {
      const dir = stack.pop()!;
      if (seenDirs.has(dir)) continue;
      seenDirs.add(dir);

      let dirents: import("node:fs").Dirent[];
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // vanished mid-walk or unreadable — skip
      }

      for (const dirent of dirents) {
        const abs = path.join(dir, dirent.name);
        try {
          const isLink = dirent.isSymbolicLink();
          if (isLink && !this.#followSymlinks) continue;

          // On non-check ticks, carry a binary file's last-known entry forward
          // without stat-ing it, so it's polled at binaryInterval, not interval.
          if (!checkBinary && !dirent.isDirectory() && this.#isBinary(abs)) {
            const prev = this.#known.get(abs);
            if (prev) found.set(abs, prev);
            continue;
          }

          const stats = isLink ? await fsp.stat(abs) : await fsp.lstat(abs);
          if (stats.isDirectory()) {
            found.set(abs, { mtimeMs: stats.mtimeMs, size: stats.size });
            if (this.#recursive && this.#shouldWatchDir(abs)) stack.push(abs);
          } else if (stats.isFile()) {
            found.set(abs, { mtimeMs: stats.mtimeMs, size: stats.size });
          }
        } catch {
          // Entry raced away between readdir and stat — ignore.
        }
      }
    }
    return found;
  }

  #isBinary(abs: string): boolean {
    return this.#binaryExtensions.has(extname(abs));
  }
}

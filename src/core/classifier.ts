import fs from "node:fs";
import type { Stats } from "node:fs";
import type { WatchEvent } from "../types/events.js";
import type { FsEntry } from "../scanner/scanner.js";
import { toEntry } from "../scanner/scanner.js";
import type { IgnoreEngine } from "../ignore/ignore-engine.js";
import type { EventFactory } from "../events/factory.js";

/** A cascaded descendant delete, carrying the inode for move pairing. */
export interface CascadeDelete {
  readonly event: WatchEvent;
  readonly ino: number;
}

/** The outcome of classifying a raw notification against the known snapshot. */
export interface Classification {
  readonly event: WatchEvent;
  /** inode used for move pairing (from the fresh stat, or the prior entry). */
  readonly ino: number;
  /** For directory deletes: the descendants also removed, as delete events. */
  readonly cascade?: CascadeDelete[];
}

/**
 * Turns a raw `(kind, path)` notification into a normalized event by comparing
 * the live filesystem against the in-memory snapshot. Mutates the snapshot so
 * subsequent notifications classify correctly. Returns `null` when the
 * notification is spurious or refers to an ignored entry.
 */
export class EventClassifier {
  readonly #snapshot: Map<string, FsEntry>;
  readonly #ignore: IgnoreEngine;
  readonly #factory: EventFactory;
  readonly #followSymlinks: boolean;

  constructor(
    snapshot: Map<string, FsEntry>,
    ignore: IgnoreEngine,
    factory: EventFactory,
    followSymlinks: boolean,
  ) {
    this.#snapshot = snapshot;
    this.#ignore = ignore;
    this.#factory = factory;
    this.#followSymlinks = followSymlinks;
  }

  classify(absolutePath: string): Classification | null {
    const prev = this.#snapshot.get(absolutePath);
    const stats = this.#statSync(absolutePath);

    if (!stats) {
      // Entry is gone.
      if (!prev) return null; // never knew about it — spurious
      this.#snapshot.delete(absolutePath);
      const cascade = prev.isDirectory ? this.#removeDescendants(absolutePath) : [];
      const event = this.#factory.create("delete", absolutePath, prev.isDirectory);
      return { event, ino: prev.ino, ...(cascade.length ? { cascade } : {}) };
    }

    const isDirectory = stats.isDirectory();
    const isFile = stats.isFile();
    if (!isDirectory && !isFile) return null; // sockets, fifos, etc.

    if (isDirectory) {
      if (this.#ignore.ignoresDirectory(absolutePath)) return null;
    } else if (this.#ignore.ignoresFile(absolutePath)) {
      return null;
    }

    if (!prev) {
      this.#snapshot.set(absolutePath, toEntry(absolutePath, stats));
      const event = this.#factory.create("create", absolutePath, isDirectory);
      return { event, ino: Number(stats.ino) };
    }

    // Known entry — only report content changes for files; directory "changes"
    // (mtime bumps from child churn) are noise and suppressed.
    if (isDirectory) return null;
    // A genuine edit changes size, mtime, or (when both collide within a
    // timestamp tick) the inode-change time. Checking ctime as well catches
    // same-size rewrites that land in the same millisecond as the prior mtime.
    if (
      stats.size === prev.size &&
      stats.mtimeMs === prev.mtimeMs &&
      stats.ctimeMs === prev.ctimeMs
    ) {
      return null;
    }

    this.#snapshot.set(absolutePath, toEntry(absolutePath, stats));
    const event = this.#factory.create("change", absolutePath, false);
    return { event, ino: Number(stats.ino) };
  }

  #removeDescendants(dirAbsolute: string): CascadeDelete[] {
    const prefix = `${dirAbsolute}/`;
    const prefixSep = `${dirAbsolute}\\`;
    const cascade: CascadeDelete[] = [];
    for (const [path, entry] of this.#snapshot) {
      if (path.startsWith(prefix) || path.startsWith(prefixSep)) {
        this.#snapshot.delete(path);
        cascade.push({
          event: this.#factory.create("delete", path, entry.isDirectory),
          ino: entry.ino,
        });
      }
    }
    return cascade;
  }

  #statSync(absolutePath: string): Stats | null {
    try {
      const lstat = fs.lstatSync(absolutePath);
      if (lstat.isSymbolicLink()) {
        if (!this.#followSymlinks) return null;
        return fs.statSync(absolutePath);
      }
      return lstat;
    } catch {
      return null;
    }
  }
}

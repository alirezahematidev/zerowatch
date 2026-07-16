import fs from "node:fs";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import type { WatchEvent } from "../types/events.js";
import type { FsEntry } from "../scanner/scanner.js";
import { toEntry } from "../scanner/scanner.js";
import type { IgnoreEngine } from "../ignore/ignore-engine.js";
import type { EventFactory } from "../events/factory.js";

/** A cascaded descendant delete, carrying the identity for move pairing. */
export interface CascadeDelete {
  readonly event: WatchEvent;
  readonly ino: number;
  readonly dev: number;
}

/** The outcome of classifying a raw notification against the known snapshot. */
export interface Classification {
  readonly event: WatchEvent;
  /** inode used for move pairing (from the fresh stat, or the prior entry). */
  readonly ino: number;
  /** device id, paired with `ino` for cross-mount-safe move pairing. */
  readonly dev: number;
  /** For directory deletes: the descendants also removed, as delete events. */
  readonly cascade?: CascadeDelete[];
  /**
   * For a same-path type flip (a file replaced by a directory or vice versa):
   * the `create` of the new entry, emitted after the `delete` of the old one
   * (and its cascade). Keeps the snapshot type-consistent and prevents the old
   * entry — and any descendants — from lingering as ghosts.
   */
  readonly replacement?: { readonly event: WatchEvent; readonly ino: number; readonly dev: number };
}

/**
 * Result of a defensive stat: the live `Stats`, or a marker distinguishing a
 * genuine disappearance (`"gone"`, → emit a delete) from a transient failure
 * such as EMFILE/EACCES or a dangling symlink target (`"unavailable"`, → no-op,
 * never a spurious delete).
 */
type StatResult = Stats | "gone" | "unavailable";

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
  readonly #hashChanges: boolean;
  readonly #onError: (error: Error) => void;

  constructor(
    snapshot: Map<string, FsEntry>,
    ignore: IgnoreEngine,
    factory: EventFactory,
    followSymlinks: boolean,
    hashChanges: boolean,
    onError: (error: Error) => void,
  ) {
    this.#snapshot = snapshot;
    this.#ignore = ignore;
    this.#factory = factory;
    this.#followSymlinks = followSymlinks;
    this.#hashChanges = hashChanges;
    this.#onError = onError;
  }

  classify(absolutePath: string): Classification | null {
    const prev = this.#snapshot.get(absolutePath);
    const stats = this.#statSync(absolutePath);

    // A transient failure (EMFILE/EACCES/EIO) or a dangling symlink target must
    // NOT be mistaken for a deletion: leave the snapshot untouched and emit
    // nothing. The error (if any) was already reported by #statSync.
    if (stats === "unavailable") return null;

    if (stats === "gone") {
      // Entry genuinely disappeared (ENOENT/ENOTDIR).
      if (!prev) return null; // never knew about it — spurious
      this.#snapshot.delete(absolutePath);
      const cascade = prev.isDirectory ? this.#removeDescendants(absolutePath) : [];
      const event = this.#factory.create("delete", absolutePath, prev.isDirectory);
      return { event, ino: prev.ino, dev: prev.dev, ...(cascade.length ? { cascade } : {}) };
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
      this.#snapshot.set(absolutePath, this.#entryFor(absolutePath, stats, isFile));
      const event = this.#factory.create("create", absolutePath, isDirectory, stats);
      return { event, ino: Number(stats.ino), dev: Number(stats.dev) };
    }

    // Same path, different kind (e.g. `rm P && mkdir P`, or an atomic swap of a
    // dir for a file). Model it as a delete of the old entry — cascading its
    // descendants when it was a directory — paired with a create of the new
    // one, so the snapshot stays type-consistent and nothing lingers as a ghost.
    if (prev.isDirectory !== isDirectory) {
      this.#snapshot.delete(absolutePath);
      const cascade = prev.isDirectory ? this.#removeDescendants(absolutePath) : [];
      const deleteEvent = this.#factory.create("delete", absolutePath, prev.isDirectory);
      this.#snapshot.set(absolutePath, this.#entryFor(absolutePath, stats, isFile));
      const createEvent = this.#factory.create("create", absolutePath, isDirectory, stats);
      return {
        event: deleteEvent,
        ino: prev.ino,
        dev: prev.dev,
        ...(cascade.length ? { cascade } : {}),
        replacement: { event: createEvent, ino: Number(stats.ino), dev: Number(stats.dev) },
      };
    }

    // Known entry, same kind — only report content changes for files; directory
    // "changes" (mtime bumps from child churn) are noise and suppressed.
    if (isDirectory) return null;
    // A genuine edit changes size, mtime, or (when both collide within a
    // timestamp tick) the inode-change time. Checking ctime as well catches
    // same-size rewrites that land in the same millisecond as the prior mtime.
    if (
      stats.size === prev.size &&
      stats.mtimeMs === prev.mtimeMs &&
      stats.ctimeMs === prev.ctimeMs
    ) {
      // Cheap checks say "unchanged". With hashChanges, confirm by content hash
      // to catch edits that restore size/mtime/ctime exactly.
      if (!this.#hashChanges) return null;
      const hash = this.#hashFile(absolutePath);
      if (prev.hash === undefined) {
        // No baseline yet (e.g. seeded entry) — record one, report nothing.
        this.#snapshot.set(absolutePath, { ...prev, ...(hash ? { hash } : {}) });
        return null;
      }
      if (hash === undefined || hash === prev.hash) return null;
      this.#snapshot.set(absolutePath, { ...toEntry(absolutePath, stats), hash });
      return { event: this.#factory.create("change", absolutePath, false, stats), ino: Number(stats.ino), dev: Number(stats.dev) };
    }

    this.#snapshot.set(absolutePath, this.#entryFor(absolutePath, stats, true));
    const event = this.#factory.create("change", absolutePath, false, stats);
    return { event, ino: Number(stats.ino), dev: Number(stats.dev) };
  }

  /** Build an entry, attaching a content hash for files when hashChanges is on. */
  #entryFor(absolutePath: string, stats: Stats, isFile: boolean): FsEntry {
    const entry = toEntry(absolutePath, stats);
    if (!this.#hashChanges || !isFile) return entry;
    const hash = this.#hashFile(absolutePath);
    return hash ? { ...entry, hash } : entry;
  }

  /** Hash a file's contents; returns undefined if it can't be read. */
  #hashFile(absolutePath: string): string | undefined {
    try {
      return createHash("sha1").update(fs.readFileSync(absolutePath)).digest("hex");
    } catch {
      return undefined;
    }
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
          dev: entry.dev,
        });
      }
    }
    return cascade;
  }

  #statSync(absolutePath: string): StatResult {
    let lstat: Stats;
    try {
      lstat = fs.lstatSync(absolutePath);
    } catch (error) {
      return this.#classifyStatError(error);
    }

    if (!lstat.isSymbolicLink()) return lstat;
    // With symlinks not followed we never track a symlink as its own entry, so
    // a path that is now a symlink reads as "gone": if it previously held a
    // tracked file/dir, that entry is genuinely gone (→ delete + cleanup);
    // if it was never tracked, the caller resolves "gone" + no prev to nothing.
    if (!this.#followSymlinks) return "gone";
    try {
      return fs.statSync(absolutePath); // resolve the link's target
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Dangling symlink: the link file still exists, only its target is gone.
      // Do not report a delete for the link itself — keep tracking it.
      if (code === "ENOENT" || code === "ENOTDIR") return "unavailable";
      return this.#classifyStatError(error);
    }
  }

  /**
   * Map a stat error to a {@link StatResult}. Only a genuine "not found"
   * (ENOENT/ENOTDIR) means the entry was deleted; every other errno
   * (EMFILE/EACCES/EIO/ELOOP…) is a transient/environmental failure that must
   * not corrupt the snapshot, so it is reported and treated as a no-op.
   */
  #classifyStatError(error: unknown): StatResult {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return "gone";
    this.#onError(error instanceof Error ? error : new Error(String(error)));
    return "unavailable";
  }
}

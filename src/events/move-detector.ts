import type { WatchEvent } from "../types/events.js";

interface Pending {
  event: WatchEvent;
  ino: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Correlates a `delete` and a `create` that share an inode within a short time
 * window and rewrites them into a single `move` event. When the two halves
 * never pair up (or inode-based detection is unavailable on the platform), the
 * original `delete`/`create` events are emitted unchanged — the documented
 * graceful fallback.
 *
 * `change` events pass straight through untouched.
 */
export class MoveDetector {
  readonly #windowMs: number;
  readonly #enabled: boolean;
  readonly #emit: (event: WatchEvent) => void;
  readonly #now: () => number;
  readonly #pendingByIno = new Map<number, Pending>();

  constructor(
    windowMs: number,
    enabled: boolean,
    emit: (event: WatchEvent) => void,
    now: () => number,
  ) {
    this.#windowMs = windowMs;
    this.#enabled = enabled;
    this.#emit = emit;
    this.#now = now;
  }

  /**
   * Feed a provisional event. `ino` is the entry's inode (0 when unknown). Only
   * `create`/`delete` participate in pairing.
   */
  feed(event: WatchEvent, ino: number): void {
    if (!this.#enabled || ino === 0 || event.type === "change" || event.type === "move") {
      this.#emit(event);
      return;
    }

    const counterpart = this.#pendingByIno.get(ino);
    if (counterpart) {
      if (this.#isPair(counterpart.event, event)) {
        clearTimeout(counterpart.timer);
        this.#pendingByIno.delete(ino);
        this.#emitMove(counterpart.event, event);
        return;
      }
      // Same inode but not a genuine move (e.g. a create+delete at the *same*
      // path, or two same-kind events): flush the held event immediately so it
      // is never lost or misreported, then fall through to hold the new one.
      clearTimeout(counterpart.timer);
      this.#pendingByIno.delete(ino);
      this.#emit(counterpart.event);
    }

    // No counterpart yet: hold this event briefly awaiting its pair.
    const timer = setTimeout(() => {
      this.#pendingByIno.delete(ino);
      this.#emit(event);
    }, this.#windowMs);
    timer.unref?.();
    this.#pendingByIno.set(ino, { event, ino, timer });
  }

  /**
   * Drop pending (unpaired) events whose path satisfies `isUnder`, without
   * emitting them. Used by `unwatch()` to discard held halves for a forgotten
   * subtree.
   */
  cancelUnder(isUnder: (absolutePath: string) => boolean): void {
    for (const [ino, pending] of this.#pendingByIno) {
      if (!isUnder(pending.event.absolutePath)) continue;
      clearTimeout(pending.timer);
      this.#pendingByIno.delete(ino);
    }
  }

  /** Drop all pending events without emitting them. */
  clear(): void {
    for (const pending of this.#pendingByIno.values()) clearTimeout(pending.timer);
    this.#pendingByIno.clear();
  }

  #isPair(a: WatchEvent, b: WatchEvent): boolean {
    // A move is a delete of one path paired with a create of a *different*
    // path that shares the inode. Same-path create+delete is not a move.
    if (a.absolutePath === b.absolutePath) return false;
    return (
      (a.type === "delete" && b.type === "create") ||
      (a.type === "create" && b.type === "delete")
    );
  }

  #emitMove(a: WatchEvent, b: WatchEvent): void {
    const deleted = a.type === "delete" ? a : b;
    const created = a.type === "create" ? a : b;
    this.#emit({
      type: "move",
      path: created.path,
      absolutePath: created.absolutePath,
      relativePath: created.relativePath,
      oldPath: deleted.absolutePath,
      timestamp: this.#now(),
      ...(created.isDirectory !== undefined ? { isDirectory: created.isDirectory } : {}),
    });
  }
}

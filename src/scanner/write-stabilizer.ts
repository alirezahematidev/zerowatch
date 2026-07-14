import fs from "node:fs";
import type { WatchEvent } from "../types/events.js";
import type { AwaitWriteOptions } from "../types/options.js";

interface PendingWrite {
  event: WatchEvent;
  emit: (event: WatchEvent) => void;
  timer: ReturnType<typeof setTimeout>;
  lastSize: number;
  lastMtimeMs: number;
  ticks: number;
}

const DEFAULTS: Required<AwaitWriteOptions> = {
  stabilityThreshold: 100,
  pollInterval: 50,
};

/**
 * Holds back `create`/`change` events for files until their size has stopped
 * changing, so consumers never observe a half-written file. Directories are
 * never stabilized (they have no meaningful "size").
 *
 * All activity for a path collapses into a single pending entry: repeated
 * writes reset the stability window rather than queuing new events, and a
 * `create` always takes precedence over a `change` for the same path so that
 * the first observation of a new file is reported as a creation even when the
 * initial write is slow.
 *
 * A monotonic tick counter (rather than wall-clock time) makes the settle
 * condition deterministic: a file is stable once its size is unchanged for
 * `ceil(stabilityThreshold / pollInterval)` consecutive polls.
 */
export class WriteStabilizer {
  readonly #options: Required<AwaitWriteOptions>;
  readonly #onError: (error: Error) => void;
  readonly #pending = new Map<string, PendingWrite>();
  readonly #requiredStableTicks: number;

  constructor(options: boolean | AwaitWriteOptions, onError: (error: Error) => void) {
    const resolved = typeof options === "object" ? { ...DEFAULTS, ...options } : { ...DEFAULTS };
    this.#options = resolved;
    this.#onError = onError;
    this.#requiredStableTicks = Math.max(1, Math.ceil(resolved.stabilityThreshold / resolved.pollInterval));
  }

  /**
   * Register `event` for stabilization; `emit` fires once its file is size
   * stable. If a stabilization for the same path is already in flight, the
   * window is reset and the pending event is upgraded to `create` when
   * appropriate, but no second emission is scheduled.
   */
  wait(event: WatchEvent, emit: (event: WatchEvent) => void): void {
    const existing = this.#pending.get(event.absolutePath);
    if (existing) {
      existing.lastSize = -1;
      existing.lastMtimeMs = -1;
      existing.ticks = 0;
      if (event.type === "create" && existing.event.type !== "create") {
        existing.event = event;
      }
      return;
    }

    const entry: PendingWrite = {
      event,
      emit,
      timer: this.#schedule(() => this.#poll(event.absolutePath)),
      lastSize: -1,
      lastMtimeMs: -1,
      ticks: 0,
    };
    this.#pending.set(event.absolutePath, entry);
  }

  /** Cancel a pending stabilization (e.g. the file was deleted). */
  cancel(absolutePath: string): void {
    const entry = this.#pending.get(absolutePath);
    if (entry) {
      clearTimeout(entry.timer);
      this.#pending.delete(absolutePath);
    }
  }

  /**
   * Cancel pending stabilizations whose path satisfies `isUnder` (used by
   * `unwatch()` to discard held writes for a forgotten subtree).
   */
  cancelUnder(isUnder: (absolutePath: string) => boolean): void {
    for (const [path, entry] of this.#pending) {
      if (!isUnder(path)) continue;
      clearTimeout(entry.timer);
      this.#pending.delete(path);
    }
  }

  /** Cancel everything (used on close). */
  clear(): void {
    for (const entry of this.#pending.values()) clearTimeout(entry.timer);
    this.#pending.clear();
  }

  #poll(absolutePath: string): void {
    fs.stat(absolutePath, (err, stats) => {
      const entry = this.#pending.get(absolutePath);
      if (!entry) return; // cancelled while stat was in flight

      if (err) {
        // File vanished mid-write (e.g. atomic rename away): drop silently; the
        // eventual delete event covers it. Non-ENOENT errors surface.
        this.#pending.delete(absolutePath);
        if (err.code !== "ENOENT") this.#onError(err);
        return;
      }

      // Stable only when both size *and* mtime hold steady, so a same-length
      // rewrite (which leaves size unchanged) still resets the window.
      if (stats.size === entry.lastSize && stats.mtimeMs === entry.lastMtimeMs) {
        entry.ticks += 1;
        if (entry.ticks >= this.#requiredStableTicks) {
          this.#pending.delete(absolutePath);
          entry.emit(entry.event);
          return;
        }
      } else {
        entry.lastSize = stats.size;
        entry.lastMtimeMs = stats.mtimeMs;
        entry.ticks = 0;
      }
      entry.timer = this.#schedule(() => this.#poll(absolutePath));
    });
  }

  #schedule(fn: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(fn, this.#options.pollInterval);
    timer.unref?.();
    return timer;
  }
}

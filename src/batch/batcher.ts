import type { WatchEvent } from "../types/events.js";

/**
 * Collects events over a fixed time window and flushes them as an array. The
 * window opens when the first event after a flush arrives, so an idle watcher
 * schedules no timers.
 *
 * A no-op when `windowMs <= 0` (the core simply never routes through it in that
 * case, but the guard keeps the class safe to construct regardless).
 */
export class Batcher {
  readonly #windowMs: number;
  readonly #flush: (events: WatchEvent[]) => void;
  #buffer: WatchEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(windowMs: number, flush: (events: WatchEvent[]) => void) {
    this.#windowMs = windowMs;
    this.#flush = flush;
  }

  /** Add an event to the current batch, opening a window if none is active. */
  push(event: WatchEvent): void {
    this.#buffer.push(event);
    if (this.#windowMs <= 0) {
      this.flush();
      return;
    }
    if (this.#timer === null) {
      const timer = setTimeout(() => this.flush(), this.#windowMs);
      timer.unref?.();
      this.#timer = timer;
    }
  }

  /** Emit the current batch immediately (if non-empty) and reset the window. */
  flush(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#buffer.length === 0) return;
    const events = this.#buffer;
    this.#buffer = [];
    this.#flush(events);
  }

  /** Drop the current batch without emitting (used on close). */
  clear(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#buffer = [];
  }
}

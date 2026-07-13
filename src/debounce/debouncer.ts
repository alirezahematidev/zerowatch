import type { WatchEvent } from "../types/events.js";

/**
 * Coalesces rapid duplicate events. Events sharing the same `(type, path)` key
 * that arrive within `windowMs` of one another collapse into a single event —
 * the most recent one, so its timestamp reflects the latest activity.
 *
 * This is the classic "editor saves a file three times in 20ms" smoothing. It
 * is a no-op passthrough when `windowMs <= 0`.
 */
export class Debouncer {
  readonly #windowMs: number;
  readonly #emit: (event: WatchEvent) => void;
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #pending = new Map<string, WatchEvent>();

  constructor(windowMs: number, emit: (event: WatchEvent) => void) {
    this.#windowMs = windowMs;
    this.#emit = emit;
  }

  /** Feed an event into the debouncer. */
  push(event: WatchEvent): void {
    if (this.#windowMs <= 0) {
      this.#emit(event);
      return;
    }
    const key = `${event.type}:${event.absolutePath}`;
    this.#pending.set(key, event);

    const existing = this.#timers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.#timers.delete(key);
      const pending = this.#pending.get(key);
      this.#pending.delete(key);
      if (pending) this.#emit(pending);
    }, this.#windowMs);
    // Do not keep the event loop alive purely for a pending debounce.
    timer.unref?.();
    this.#timers.set(key, timer);
  }

  /** Immediately flush all pending events and cancel timers (used on close). */
  flush(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const event of pending) this.#emit(event);
  }

  /** Drop all pending events without emitting them. */
  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#pending.clear();
  }
}

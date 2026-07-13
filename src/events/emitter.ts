/**
 * A tiny, fully-typed event emitter with no runtime dependencies.
 *
 * It is intentionally not built on `node:events` so that listener signatures are
 * derived from a per-emitter event map, giving callers precise argument types
 * for `on`/`off`/`once`/`emit` with no `any` anywhere.
 *
 * `Events` maps each event name to the listener function accepted for it.
 */
export type EventListener = (...args: never[]) => void;

export class TypedEmitter<Events extends Record<keyof Events, EventListener>> {
  readonly #listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();
  /** Maps a once() wrapper back to its original listener, so `off()` can find it. */
  readonly #onceOriginals = new WeakMap<
    (...args: never[]) => void,
    (...args: never[]) => void
  >();

  /** Register `listener` for `event`. Returns `this` for chaining. */
  on<E extends keyof Events>(event: E, listener: Events[E]): this {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  /** Register a one-shot `listener` that removes itself after first firing. */
  once<E extends keyof Events>(event: E, listener: Events[E]): this {
    const wrapper = ((...args: never[]) => {
      this.off(event, wrapper as Events[E]);
      (listener as (...a: never[]) => void)(...args);
    }) as Events[E];
    this.#onceOriginals.set(
      wrapper as (...args: never[]) => void,
      listener as (...args: never[]) => void,
    );
    return this.on(event, wrapper);
  }

  /**
   * Remove a listener. With no `listener`, removes all listeners for `event`.
   * With no arguments at all, removes every listener.
   */
  off<E extends keyof Events>(event?: E, listener?: Events[E]): this {
    if (event === undefined) {
      this.#listeners.clear();
      return this;
    }
    const set = this.#listeners.get(event);
    if (!set) return this;
    if (listener === undefined) {
      this.#listeners.delete(event);
    } else {
      set.delete(listener);
      // Also remove a pending once() wrapper registered for this original.
      for (const registered of set) {
        if (this.#onceOriginals.get(registered) === listener) set.delete(registered);
      }
      if (set.size === 0) this.#listeners.delete(event);
    }
    return this;
  }

  /**
   * Synchronously invoke all listeners for `event`. A throwing listener never
   * prevents the remaining listeners from running; the thrown value is
   * re-surfaced through {@link TypedEmitter.onListenerError} so callers can
   * decide how to report it (the watcher routes it to its `error` event).
   */
  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return false;
    // Fast path: a single listener needs no defensive snapshot allocation.
    if (set.size === 1) {
      const only = set.values().next().value as (...a: never[]) => void;
      try {
        only(...(args as never[]));
      } catch (error) {
        this.onListenerError(error, event);
      }
      return true;
    }
    // Snapshot so listeners may add/remove during iteration safely.
    for (const listener of [...set]) {
      try {
        (listener as (...a: never[]) => void)(...(args as never[]));
      } catch (error) {
        this.onListenerError(error, event);
      }
    }
    return true;
  }

  /** Number of listeners currently registered for `event`. */
  listenerCount<E extends keyof Events>(event: E): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  /**
   * Hook invoked when a listener throws. Overridden by subclasses; the default
   * re-throws on a microtask so the failure is not silently swallowed.
   */
  protected onListenerError(error: unknown, _event: keyof Events): void {
    queueMicrotask(() => {
      throw error;
    });
  }
}

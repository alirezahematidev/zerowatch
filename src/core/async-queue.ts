/** Backpressure configuration for {@link AsyncQueue}. */
export interface AsyncQueueOptions<T> {
  /** Max values buffered for a slow consumer; `0` (default) means unbounded. */
  readonly maxBuffered?: number;
  /** Called with each value dropped once the buffer is full. */
  readonly onDrop?: (value: T) => void;
}

/**
 * A single-consumer async queue backing `Symbol.asyncIterator`.
 *
 * Producers call {@link AsyncQueue.push} to enqueue values and {@link AsyncQueue.end}
 * (optionally with an error) to terminate the stream. A consumer drives it via
 * the standard async-iterator protocol. Values pushed while no consumer is
 * waiting are buffered so nothing is lost between `await` turns.
 *
 * With `maxBuffered` set, the buffer is bounded: once it is full the oldest
 * value is dropped (and reported via `onDrop`) to bound memory when a consumer
 * cannot keep up.
 */
export class AsyncQueue<T> implements AsyncIterableIterator<T> {
  readonly #buffer: T[] = [];
  readonly #waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  #ended = false;
  #error: unknown = undefined;
  readonly #maxBuffered: number;
  readonly #onDrop: ((value: T) => void) | undefined;

  constructor(options: AsyncQueueOptions<T> = {}) {
    this.#maxBuffered = Math.max(0, options.maxBuffered ?? 0);
    this.#onDrop = options.onDrop;
  }

  /** Enqueue a value, waking the pending consumer if one is waiting. */
  push(value: T): void {
    if (this.#ended) return;
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
    } else {
      this.#buffer.push(value);
      // Bounded buffer: drop the oldest value(s) once over the high-water mark.
      while (this.#maxBuffered > 0 && this.#buffer.length > this.#maxBuffered) {
        const dropped = this.#buffer.shift() as T;
        this.#onDrop?.(dropped);
      }
    }
  }

  /**
   * Terminate the stream. Any buffered values are still drained before the
   * consumer sees `done`. If `error` is provided, the consumer's pending (or
   * next) `next()` rejects once the buffer is empty.
   */
  end(error?: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#error = error;
    // Nothing buffered: settle every waiter immediately.
    if (this.#buffer.length === 0) {
      for (const waiter of this.#waiters.splice(0)) {
        if (error !== undefined) waiter.reject(error);
        else waiter.resolve({ value: undefined, done: true });
      }
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.#buffer.length > 0) {
      const value = this.#buffer.shift() as T;
      return Promise.resolve({ value, done: false });
    }
    if (this.#ended) {
      if (this.#error !== undefined) return Promise.reject(this.#error);
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  /** Allows `break`/`return` in a `for await` loop to shut the stream down. */
  return(): Promise<IteratorResult<T>> {
    this.end();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

import type { PlatformSink, RawFsEvent } from "../types/internal.js";

/**
 * A {@link PlatformSink} façade that references the real sink **weakly**.
 *
 * An active `fs.watch` handle is a GC root, and it strongly references its
 * `'change'` listener — which closes over the platform adapter's sink, which
 * closes over the owning `Watcher`. Left strong, that chain pins the `Watcher`
 * in memory for as long as any handle is open, so the leak-safety
 * {@link FinalizationRegistry} could never fire. Routing the adapter → sink
 * edge through a `WeakRef` severs it: once the `Watcher` (and its sink) are
 * collected, `deref()` returns `undefined` and further notifications are
 * dropped, leaving the handle collectable and the registry free to fire.
 */
export class WeakSink implements PlatformSink {
  readonly #ref: WeakRef<PlatformSink>;

  constructor(sink: PlatformSink) {
    this.#ref = new WeakRef(sink);
  }

  onEvent(event: RawFsEvent): void {
    this.#ref.deref()?.onEvent(event);
  }

  onError(error: Error): void {
    this.#ref.deref()?.onError(error);
  }
}

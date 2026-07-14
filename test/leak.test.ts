import { describe, it, expect } from "vitest";
import { WeakSink } from "../src/platform/weak-sink.js";
import { closeLeakedWatchers } from "../src/core/leak-registry.js";
import type {
  PlatformSink,
  PlatformWatcher,
  RawFsEvent,
} from "../src/types/internal.js";

describe("WeakSink", () => {
  it("forwards events and errors while the referent is alive", () => {
    const events: RawFsEvent[] = [];
    const errors: Error[] = [];
    const real: PlatformSink = {
      onEvent: (e) => events.push(e),
      onError: (err) => errors.push(err),
    };
    const weak = new WeakSink(real);

    const raw: RawFsEvent = { kind: "change", absolutePath: "/tmp/x" };
    weak.onEvent(raw);
    const err = new Error("boom");
    weak.onError(err);

    expect(events).toEqual([raw]);
    expect(errors).toEqual([err]);
  });
});

describe("closeLeakedWatchers", () => {
  function fakeWatcher(onClose: () => void): PlatformWatcher {
    return { start: async () => {}, close: async () => { onClose(); } };
  }

  it("closes every watcher in the holder and empties the set", () => {
    let closed = 0;
    const holder = {
      watchers: new Set([fakeWatcher(() => closed++), fakeWatcher(() => closed++)]),
    };

    closeLeakedWatchers(holder);

    expect(closed).toBe(2);
    expect(holder.watchers.size).toBe(0);
  });

  it("keeps going when a watcher's close() throws (finalizers must not throw)", () => {
    let closed = 0;
    const holder = {
      watchers: new Set<PlatformWatcher>([
        { start: async () => {}, close: () => { throw new Error("nope"); } },
        fakeWatcher(() => closed++),
      ]),
    };

    expect(() => closeLeakedWatchers(holder)).not.toThrow();
    expect(closed).toBe(1);
    expect(holder.watchers.size).toBe(0);
  });
});

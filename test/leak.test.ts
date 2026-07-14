import { describe, it, expect } from "vitest";
import { WeakSink } from "../src/platform/weak-sink.js";
import type { PlatformSink, RawFsEvent } from "../src/types/internal.js";

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

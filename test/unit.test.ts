import { describe, it, expect, vi } from "vitest";
import { TypedEmitter } from "../src/events/emitter.js";
import { AsyncQueue } from "../src/core/async-queue.js";
import { Debouncer } from "../src/debounce/debouncer.js";
import { Batcher } from "../src/batch/batcher.js";
import { MoveDetector } from "../src/events/move-detector.js";
import type { WatchEvent } from "../src/index.js";

function event(type: WatchEvent["type"], name: string, ts = 0): WatchEvent {
  return {
    type,
    path: name,
    relativePath: name,
    absolutePath: `/abs/${name}`,
    timestamp: ts,
  };
}

interface Events extends Record<string, (...a: never[]) => void> {
  ping: (n: number) => void;
  err: () => void;
}

describe("TypedEmitter", () => {
  it("registers, fires, and removes listeners", () => {
    const em = new TypedEmitter<Events>();
    const fn = vi.fn();
    em.on("ping", fn);
    em.emit("ping", 1);
    em.emit("ping", 2);
    expect(fn).toHaveBeenCalledTimes(2);
    em.off("ping", fn);
    em.emit("ping", 3);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("supports once", () => {
    const em = new TypedEmitter<Events>();
    const fn = vi.fn();
    em.once("ping", fn);
    em.emit("ping", 1);
    em.emit("ping", 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("off() removes a pending once() listener by its original reference", () => {
    const em = new TypedEmitter<Events>();
    const fn = vi.fn();
    em.once("ping", fn);
    em.off("ping", fn); // remove before it ever fires
    em.emit("ping", 1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("isolates a throwing listener from the rest", () => {
    // Subclass to capture listener errors instead of the base class's
    // microtask re-throw, so the assertion stays fully synchronous.
    const errors: unknown[] = [];
    class CapturingEmitter extends TypedEmitter<Events> {
      protected override onListenerError(error: unknown): void {
        errors.push(error);
      }
    }
    const em = new CapturingEmitter();
    const seen: number[] = [];
    em.on("ping", () => {
      throw new Error("boom");
    });
    em.on("ping", (n) => seen.push(n));
    em.emit("ping", 5);
    expect(seen).toEqual([5]);
    expect(errors).toHaveLength(1);
  });
});

describe("AsyncQueue", () => {
  it("delivers buffered values then completes", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.end();
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1, 2]);
  });

  it("wakes a pending consumer when a value arrives", async () => {
    const q = new AsyncQueue<number>();
    const next = q.next();
    q.push(42);
    expect(await next).toEqual({ value: 42, done: false });
  });

  it("propagates an end error", async () => {
    const q = new AsyncQueue<number>();
    q.end(new Error("stream failed"));
    await expect(q.next()).rejects.toThrow("stream failed");
  });
});

describe("Debouncer", () => {
  it("coalesces duplicate type+path within the window", async () => {
    vi.useFakeTimers();
    try {
      const out: WatchEvent[] = [];
      const d = new Debouncer(100, (e) => out.push(e));
      d.push(event("change", "a", 1));
      d.push(event("change", "a", 2));
      d.push(event("change", "a", 3));
      vi.advanceTimersByTime(120);
      expect(out).toHaveLength(1);
      expect(out[0]!.timestamp).toBe(3); // latest wins
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps distinct keys separate", async () => {
    vi.useFakeTimers();
    try {
      const out: WatchEvent[] = [];
      const d = new Debouncer(100, (e) => out.push(e));
      d.push(event("change", "a"));
      d.push(event("create", "a"));
      d.push(event("change", "b"));
      vi.advanceTimersByTime(120);
      expect(out).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a passthrough when disabled", () => {
    const out: WatchEvent[] = [];
    const d = new Debouncer(0, (e) => out.push(e));
    d.push(event("change", "a"));
    d.push(event("change", "a"));
    expect(out).toHaveLength(2);
  });
});

describe("MoveDetector", () => {
  const ino = 42;

  it("pairs a delete and create at different paths sharing an inode into a move", () => {
    vi.useFakeTimers();
    try {
      const out: WatchEvent[] = [];
      const md = new MoveDetector(100, true, (e) => out.push(e), () => 0);
      md.feed(event("delete", "from.txt"), ino);
      md.feed(event("create", "to.txt"), ino);
      expect(out).toHaveLength(1);
      expect(out[0]!.type).toBe("move");
      expect(out[0]!.oldPath).toBe("/abs/from.txt");
      expect(out[0]!.absolutePath).toBe("/abs/to.txt");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not treat a same-path create+delete as a move", () => {
    vi.useFakeTimers();
    try {
      const out: WatchEvent[] = [];
      const md = new MoveDetector(100, true, (e) => out.push(e), () => 0);
      md.feed(event("create", "a.txt"), ino);
      md.feed(event("delete", "a.txt"), ino);
      vi.advanceTimersByTime(120);
      expect(out.map((e) => e.type)).toEqual(["create", "delete"]);
      expect(out.some((e) => e.type === "move")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Batcher", () => {
  it("flushes collected events as an array after the window", () => {
    vi.useFakeTimers();
    try {
      const batches: WatchEvent[][] = [];
      const b = new Batcher(200, (events) => batches.push(events));
      b.push(event("create", "a"));
      b.push(event("change", "b"));
      expect(batches).toHaveLength(0);
      vi.advanceTimersByTime(210);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a new window per burst", () => {
    vi.useFakeTimers();
    try {
      const batches: WatchEvent[][] = [];
      const b = new Batcher(100, (events) => batches.push(events));
      b.push(event("create", "a"));
      vi.advanceTimersByTime(110);
      b.push(event("create", "b"));
      vi.advanceTimersByTime(110);
      expect(batches).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import type { WatchEvent } from "../types/events.js";
import type {
  WatcherEventMap,
  WatcherEventName,
  WatchOptions,
} from "../types/options.js";
import type {
  PlatformSink,
  PlatformWatcher,
  PlatformWatchTarget,
  RawFsEvent,
} from "../types/internal.js";
import { TypedEmitter } from "../events/emitter.js";
import { EventFactory } from "../events/factory.js";
import { MoveDetector } from "../events/move-detector.js";
import { AsyncQueue } from "./async-queue.js";
import { resolveOptions, type ResolvedOptions } from "./resolve-options.js";
import { leakRegistry, type WatcherHolder } from "./leak-registry.js";
import { EventClassifier } from "./classifier.js";
import { IgnoreEngine } from "../ignore/ignore-engine.js";
import { Debouncer } from "../debounce/debouncer.js";
import { Batcher } from "../batch/batcher.js";
import { WriteStabilizer } from "../scanner/write-stabilizer.js";
import { scan, type FsEntry } from "../scanner/scanner.js";
import { createPlatformWatcher, inodeMoveDetectionSupported } from "../platform/index.js";
import { relativeTo } from "../utils/paths.js";

/** Internal lifecycle states. */
type State = "idle" | "starting" | "ready" | "closed";

/**
 * The unit yielded by the async iterator: single events, or arrays when
 * batching is enabled via {@link WatchOptions.batch}.
 */
export type EmittedUnit = WatchEvent | WatchEvent[];

/**
 * The core watcher. Orchestrates platform adapters, the ignore engine, and the
 * event-processing pipeline (classify → move-detect → await-write → debounce →
 * batch → deliver), exposing everything through typed events and an async
 * iterator.
 *
 * `T` is the async-iterator element type: {@link WatchEvent} normally, or
 * `WatchEvent[]` when `batch` is enabled.
 *
 * Construct one via {@link watch} or {@link createWatcher} rather than directly.
 *
 * @example
 * ```ts
 * const watcher = watch("src");
 * watcher.on("all", (e) => console.log(e.type, e.relativePath));
 * await watcher.ready();          // initial scan complete, now live
 * await watcher.add("tests");     // watch more paths on the fly
 * watcher.pause();                // buffer events…
 * watcher.resume();               // …and flush them
 * await watcher.close();          // release handles, end iteration
 * ```
 */
export class Watcher<T extends EmittedUnit = WatchEvent>
  implements AsyncIterable<T>
{
  readonly #targets: string[];
  readonly #options: ResolvedOptions;
  readonly #root: string;
  readonly #now: () => number;

  readonly #emitter = new WatcherInternalEmitter();
  readonly #queue: AsyncQueue<EmittedUnit>;
  readonly #snapshot = new Map<string, FsEntry>();

  #ignore!: IgnoreEngine;
  #factory!: EventFactory;
  #classifier!: EventClassifier;
  #moveDetector!: MoveDetector;
  #debouncer!: Debouncer;
  #stabilizer: WriteStabilizer | null = null;
  #batcher: Batcher | null = null;

  /** Platform adapters keyed by their target's absolute path (for unwatch()). */
  readonly #watchers = new Map<string, PlatformWatcher>();
  /**
   * Same platform adapters, in a back-reference-free holder registered with the
   * leak-safety FinalizationRegistry. Kept in sync with #watchers.
   */
  readonly #holder: WatcherHolder = { watchers: new Set() };
  #sink!: PlatformSink;

  #state: State = "idle";
  #paused = false;
  /** Cumulative count of events dropped by the bounded queue (backpressure). */
  #dropped = 0;
  readonly #pausedBuffer: WatchEvent[] = [];
  readonly #rawBuffer: RawFsEvent[] = [];

  #readyPromise: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (error: unknown) => void;

  constructor(paths: string | string[], options: WatchOptions = {}, now: () => number = Date.now) {
    this.#targets = Array.isArray(paths) ? [...paths] : [paths];
    if (this.#targets.length === 0) {
      throw new TypeError("zerowatch: at least one path is required");
    }
    this.#now = now;
    const cwd = options.cwd ?? process.cwd();
    this.#options = resolveOptions(options, cwd);
    this.#root = this.#computeRoot();
    this.#queue = new AsyncQueue<EmittedUnit>({
      maxBuffered: this.#options.maxBufferedEvents,
      // Surface backpressure: when a bounded buffer evicts an undelivered event,
      // report the cumulative drop count so consumers can observe loss instead
      // of it being silent. Guarded like other emissions — never crashes.
      onDrop: () => {
        this.#dropped += 1;
        this.#emitter.emit("drop", { count: this.#dropped });
      },
    });

    this.#readyPromise = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    // A startup failure rejects this promise. Attach an inert handler so that a
    // caller who never awaits ready() does not trigger an unhandled rejection —
    // the failure is still surfaced via the `error` event and to anyone who
    // does await ready(). (Each .catch/.then forms an independent branch, so
    // this does not consume the rejection for the caller's own chain.)
    this.#readyPromise.catch(() => {});
    // Route listener errors to the `error` event; never crash the process.
    this.#emitter.setErrorSink((error) => this.#reportError(error));

    // Kick off startup on the next microtask so callers can attach listeners
    // (`.on('ready', …)`) synchronously after construction.
    queueMicrotask(() => {
      void this.#start();
    });
  }

  // ---------------------------------------------------------------- public API

  /** Resolves once the initial scan has completed and the watcher is live. */
  ready(): Promise<void> {
    return this.#readyPromise;
  }

  /** Register a listener for a watcher event. */
  on<E extends WatcherEventName>(event: E, listener: WatcherEventMap[E]): this {
    this.#emitter.on(event, listener);
    return this;
  }

  /** Register a one-shot listener. */
  once<E extends WatcherEventName>(event: E, listener: WatcherEventMap[E]): this {
    this.#emitter.once(event, listener);
    return this;
  }

  /** Remove a listener (or all listeners for an event, or all listeners). */
  off<E extends WatcherEventName>(event?: E, listener?: WatcherEventMap[E]): this {
    this.#emitter.off(event, listener);
    return this;
  }

  /** Stop delivering events. Events that occur while paused are buffered. */
  pause(): void {
    this.#paused = true;
  }

  /** Resume delivery, flushing anything buffered while paused. */
  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    const buffered = this.#pausedBuffer.splice(0);
    for (const event of buffered) this.#deliver(event);
  }

  /** True while the watcher is paused. */
  get paused(): boolean {
    return this.#paused;
  }

  /**
   * The paths currently tracked, grouped by their parent directory (relative to
   * the watched root) mapping to child basenames — chokidar-compatible shape.
   */
  getWatched(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const abs of this.#snapshot.keys()) {
      const rel = relativeTo(this.#root, abs);
      const slash = rel.lastIndexOf("/");
      const dir = slash === -1 ? "." : rel.slice(0, slash);
      const name = slash === -1 ? rel : rel.slice(slash + 1);
      (out[dir] ??= []).push(name);
    }
    for (const names of Object.values(out)) names.sort();
    return out;
  }

  /**
   * Begin watching one or more additional paths on a live watcher. Resolves once
   * the new targets are attached and their pre-existing entries seeded (initial
   * `create`s are emitted unless `ignoreInitial` is set). No-op for paths already
   * watched, or after the watcher is closed.
   */
  async add(paths: string | string[]): Promise<void> {
    const list = Array.isArray(paths) ? paths : [paths];
    if (this.#isClosed()) return;
    // Adding is a live operation; wait until the initial startup has settled.
    if (this.#state !== "ready") await this.#readyPromise.catch(() => {});
    if (this.#isClosed()) return;

    for (const target of this.#toTargets(list)) {
      if (this.#watchers.has(target.absolutePath)) continue;
      await this.#startTarget(target);
      if (this.#isClosed()) return;
      await this.#seed(target);
    }
  }

  /**
   * Stop watching one or more paths. Closes their platform handles and forgets
   * their tracked entries. No delete events are emitted for the forgotten
   * subtree — the caller asked to stop watching it.
   */
  async unwatch(paths: string | string[]): Promise<void> {
    const list = Array.isArray(paths) ? paths : [paths];
    for (const target of this.#toTargets(list)) {
      const watcher = this.#watchers.get(target.absolutePath);
      if (!watcher) continue;
      this.#watchers.delete(target.absolutePath);
      this.#holder.watchers.delete(watcher);
      await watcher.close();
      // Drop any in-flight holds for the subtree so no event is delivered for a
      // path the caller explicitly stopped watching.
      this.#cancelHoldsUnder(target.absolutePath);
      this.#forgetSubtree(target.absolutePath);
    }
  }

  /** Stop watching, release all handles, and terminate the async iterator. */
  async close(): Promise<void> {
    if (this.#state === "closed") return;
    this.#state = "closed";
    // close() supersedes the backstop: stop tracking so the finalizer is a no-op.
    leakRegistry.unregister(this);
    this.#holder.watchers.clear();

    // `allSettled`, not `all`: a platform adapter's close() rejecting must not
    // skip the pipeline teardown below and leave the async iterator hanging.
    await Promise.allSettled([...this.#watchers.values()].map((p) => p.close()));
    this.#watchers.clear();

    // Speculative holds (move pairing, write stability) are always dropped.
    this.#stabilizer?.clear();
    this.#moveDetector?.clear();
    if (this.#options.flushOnClose) {
      // Deliver everything still held. Un-pause first and drain the paused
      // buffer directly, otherwise the flush below would route back through the
      // pause gate into #pausedBuffer and be silently dropped.
      this.#paused = false;
      for (const event of this.#pausedBuffer.splice(0)) this.#deliver(event);
      // Emit anything still delayed purely for coalescing.
      this.#debouncer?.flush();
      this.#batcher?.flush();
    } else {
      this.#debouncer?.clear();
      this.#batcher?.clear();
    }

    this.#queue.end();
    this.#emitter.emit("close");
    // If we never reached ready, unblock any awaiter.
    this.#resolveReady();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.#queue[Symbol.asyncIterator]() as AsyncIterator<T>;
  }

  // ------------------------------------------------------------------ startup

  async #start(): Promise<void> {
    if (this.#state !== "idle") return;
    this.#state = "starting";
    // Backstop: if this Watcher is dropped without close(), the registry closes
    // any handles still in #holder. `this` is also the unregister token.
    leakRegistry.register(this, this.#holder, this);

    this.#ignore = IgnoreEngine.create(this.#root, this.#options.raw);
    this.#factory = new EventFactory(this.#root, this.#now);
    this.#classifier = new EventClassifier(
      this.#snapshot,
      this.#ignore,
      this.#factory,
      this.#options.followSymlinks,
      this.#options.hashChanges,
      (error) => this.#reportError(error),
    );
    this.#moveDetector = new MoveDetector(
      this.#options.moveWindow,
      inodeMoveDetectionSupported,
      (event) => this.#afterMove(event),
      this.#now,
    );
    this.#debouncer = new Debouncer(this.#options.debounce, (event) =>
      this.#dispatch(event),
    );
    if (this.#options.awaitWrite !== false) {
      this.#stabilizer = new WriteStabilizer(this.#options.awaitWrite, (error) =>
        this.#reportError(error),
      );
    }
    if (this.#options.batch > 0) {
      this.#batcher = new Batcher(this.#options.batch, (events) => {
        this.#emitter.emit("batch", events);
        this.#queue.push(events);
      });
    }

    this.#sink = {
      onEvent: (event) => this.#onRaw(event),
      onError: (error) => this.#reportError(error),
    };

    try {
      const targets = this.#resolveTargets();
      for (const target of targets) {
        // A concurrent close() may land while we await; abort so we neither
        // spin up further handles nor resurrect a closed watcher.
        if (this.#isClosed()) return;
        await this.#startTarget(target);
      }

      // Seed the snapshot and emit initial `create`s (unless suppressed).
      for (const target of targets) {
        if (this.#isClosed()) return;
        await this.#seed(target);
      }

      if (this.#isClosed()) return;
      this.#state = "ready";
      this.#drainRawBuffer();

      this.#emitter.emit("ready");
      this.#resolveReady();
    } catch (error) {
      // A hard startup failure rejects ready() and surfaces an error event.
      this.#reportError(error);
      if (!this.#isClosed()) {
        this.#state = "ready";
        // Drain anything buffered so far so partially-started watchers still
        // deliver, then reject ready() for callers who awaited it.
        this.#drainRawBuffer();
        this.#rejectReady(error);
      }
    }
  }

  /** Create, register, and start a platform adapter for one target. */
  async #startTarget(target: PlatformWatchTarget): Promise<void> {
    const platform = createPlatformWatcher(
      target,
      this.#sink,
      (dir) => !this.#ignore.ignoresDirectory(dir) && this.#canDescend(dir),
      {
        usePolling: this.#options.usePolling,
        interval: this.#options.interval,
        binaryInterval: this.#options.binaryInterval,
        binaryExtensions: this.#options.binaryExtensions,
      },
    );
    this.#watchers.set(target.absolutePath, platform);
    this.#holder.watchers.add(platform);
    await platform.start();
  }

  /** Depth of `abs` relative to the watched root; root's children are depth 0. */
  #depthOf(abs: string): number {
    const rel = path.relative(this.#root, abs);
    if (rel === "" || rel === ".") return -1; // the root itself
    return rel.split(path.sep).length - 1;
  }

  /** May we descend into `dir` (i.e. are its children within the depth limit)? */
  #canDescend(dir: string): boolean {
    return this.#depthOf(dir) < this.#options.depth;
  }

  /** Is `abs` within the configured depth limit (so events for it are kept)? */
  #withinDepth(abs: string): boolean {
    return this.#depthOf(abs) <= this.#options.depth;
  }

  /** Process raw notifications that arrived before the watcher became ready. */
  #drainRawBuffer(): void {
    const buffered = this.#rawBuffer.splice(0);
    for (const raw of buffered) this.#processRaw(raw);
  }

  /** Cancel pipeline holds (write-stability, debounce, move pairing) for a subtree. */
  #cancelHoldsUnder(absolutePath: string): void {
    const prefix = `${absolutePath}${path.sep}`;
    const altPrefix = `${absolutePath}/`;
    const isUnder = (abs: string): boolean =>
      abs === absolutePath || abs.startsWith(prefix) || abs.startsWith(altPrefix);
    this.#stabilizer?.cancelUnder(isUnder);
    this.#debouncer.cancelUnder(isUnder);
    this.#moveDetector.cancelUnder(isUnder);
  }

  /** Forget every tracked entry at or beneath `absolutePath` (used by unwatch). */
  #forgetSubtree(absolutePath: string): void {
    const prefix = `${absolutePath}${path.sep}`;
    const altPrefix = `${absolutePath}/`;
    for (const abs of this.#snapshot.keys()) {
      if (abs === absolutePath || abs.startsWith(prefix) || abs.startsWith(altPrefix)) {
        this.#snapshot.delete(abs);
      }
    }
  }

  async #seed(target: PlatformWatchTarget): Promise<void> {
    const entries = await scan(
      target.absolutePath,
      {
        recursive: target.recursive,
        followSymlinks: this.#options.followSymlinks,
        maxDepth: this.#options.depth,
      },
      this.#ignore,
      (error) => this.#reportError(error),
    );
    for (const [abs, entry] of entries) {
      // Only genuinely new entries get seeded — and only they emit an initial
      // create. Re-seeding an overlapping subtree (e.g. add() of a path already
      // covered by a recursive watch) must not re-announce known entries.
      if (this.#snapshot.has(abs)) continue;
      this.#snapshot.set(abs, entry);
      if (!this.#options.ignoreInitial) {
        const event = this.#factory.create("create", abs, entry.isDirectory);
        this.#dispatch(event);
      }
    }
  }

  // ---------------------------------------------------------- event pipeline

  #onRaw(event: RawFsEvent): void {
    if (this.#state === "closed") return;
    if (this.#state !== "ready") {
      this.#rawBuffer.push(event);
      return;
    }
    this.#processRaw(event);
  }

  #processRaw(raw: RawFsEvent): void {
    // Enforce the depth limit uniformly, including for native recursive backends
    // that report events from arbitrarily deep in the tree.
    if (this.#options.depth !== Infinity && !this.#withinDepth(raw.absolutePath)) {
      return;
    }
    const result = this.#classifier.classify(raw.absolutePath);
    if (!result) return;

    const { event, ino, dev, cascade, replacement } = result;

    // Deletes cancel any in-flight write stabilization.
    if (event.type === "delete") this.#stabilizer?.cancel(event.absolutePath);

    this.#moveDetector.feed(event, ino, dev);

    // A brand-new directory may already contain files (e.g. `mkdir -p a/b`,
    // moved-in trees, or races before a manual watcher attaches). Scan it in.
    if (event.type === "create" && event.isDirectory && this.#options.recursive) {
      void this.#scanNewDirectory(event.absolutePath);
    }

    if (cascade) {
      for (const child of cascade) {
        this.#stabilizer?.cancel(child.event.absolutePath);
        // Feed the child's real identity so a moved-in counterpart can pair it
        // into a move (bounded by moveWindow); otherwise it emits as a plain delete.
        this.#moveDetector.feed(child.event, child.ino, child.dev);
      }
    }

    // A same-path type flip: emit the create of the replacement entry after the
    // delete (+ cascade) above, mirroring the normal create handling.
    if (replacement) {
      this.#moveDetector.feed(replacement.event, replacement.ino, replacement.dev);
      if (replacement.event.isDirectory && this.#options.recursive) {
        void this.#scanNewDirectory(replacement.event.absolutePath);
      }
    }
  }

  /** Second pipeline stage: await-write, then debounce. */
  #afterMove(event: WatchEvent): void {
    const isFile = event.isDirectory !== true;
    const holdForWrite =
      this.#stabilizer !== null &&
      isFile &&
      (event.type === "create" || event.type === "change");

    if (holdForWrite) {
      this.#stabilizer!.wait(event, (stable) => this.#debouncer.push(stable));
    } else {
      this.#debouncer.push(event);
    }
  }

  /** Third stage: honor pause, then deliver. */
  #dispatch(event: WatchEvent): void {
    if (this.#paused) {
      this.#pausedBuffer.push(event);
      return;
    }
    this.#deliver(event);
  }

  /** Final stage: fan out to listeners and the async iterator. */
  #deliver(event: WatchEvent): void {
    this.#emitter.emit(event.type, event);
    this.#emitter.emit("all", event);
    if (this.#batcher) {
      this.#batcher.push(event);
    } else {
      this.#queue.push(event);
    }
  }

  async #scanNewDirectory(dirAbsolute: string): Promise<void> {
    if (this.#state === "closed") return;
    // Translate the global depth limit into a budget relative to this subdir:
    // its direct children sit at overall depth `#depthOf(dir) + 1`.
    let subMaxDepth = Infinity;
    if (this.#options.depth !== Infinity) {
      subMaxDepth = this.#options.depth - (this.#depthOf(dirAbsolute) + 1);
      if (subMaxDepth < 0) return; // children already beyond the limit
    }
    const entries = await scan(
      dirAbsolute,
      {
        recursive: true,
        followSymlinks: this.#options.followSymlinks,
        maxDepth: subMaxDepth,
      },
      this.#ignore,
      (error) => this.#reportError(error),
    );
    // A concurrent close() may have landed while the scan was in flight; bail so
    // we neither mutate a closed watcher's snapshot nor deliver events (and
    // schedule move/debounce timers) after the terminal `close` event.
    if (this.#isClosed()) return;
    for (const [abs, entry] of entries) {
      if (this.#snapshot.has(abs)) continue;
      this.#snapshot.set(abs, entry);
      const event = this.#factory.create("create", abs, entry.isDirectory);
      this.#moveDetector.feed(event, entry.ino, entry.dev);
    }
  }

  // ------------------------------------------------------------------ helpers

  #isClosed(): boolean {
    return this.#state === "closed";
  }

  #reportError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    // Only emit if someone is listening, else swallow (never crash).
    if (this.#emitter.listenerCount("error") > 0) {
      this.#emitter.emit("error", err);
    }
  }

  #computeRoot(): string {
    const cwd = this.#options.cwd;
    if (this.#targets.length === 1) {
      const abs = path.resolve(cwd, this.#targets[0]!);
      try {
        return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
      } catch {
        return abs;
      }
    }
    return path.resolve(cwd);
  }

  #resolveTargets(): PlatformWatchTarget[] {
    return this.#toTargets(this.#targets);
  }

  #toTargets(paths: string[]): PlatformWatchTarget[] {
    return paths.map((target) => {
      const abs = path.resolve(this.#options.cwd, target);
      let isDirectory = true;
      try {
        isDirectory = fs.statSync(abs).isDirectory();
      } catch {
        // Assume directory if it doesn't exist yet; watch may still fail loudly.
      }
      return {
        absolutePath: abs,
        isDirectory,
        recursive: isDirectory && this.#options.recursive,
        followSymlinks: this.#options.followSymlinks,
      };
    });
  }
}

/**
 * Emitter subclass that redirects listener exceptions to a caller-provided sink
 * (the watcher's `error` event) instead of the default microtask re-throw, so a
 * throwing user listener can never crash the host process.
 */
class WatcherInternalEmitter extends TypedEmitter<WatcherEventMap> {
  #errorSink: ((error: unknown) => void) | null = null;

  setErrorSink(sink: (error: unknown) => void): void {
    this.#errorSink = sink;
  }

  protected override onListenerError(error: unknown, event: WatcherEventName): void {
    // Avoid infinite recursion if an `error` listener itself throws.
    if (event === "error" || !this.#errorSink) {
      queueMicrotask(() => {
        throw error;
      });
      return;
    }
    this.#errorSink(error);
  }
}

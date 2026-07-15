import { normalizeExtension } from "../utils/paths.js";
import type { AwaitWriteOptions, WatchOptions } from "../types/options.js";

/** Extensions polled at `binaryInterval` by default (common non-text assets). */
const DEFAULT_BINARY_EXTENSIONS = [
  // images
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tiff", ".avif",
  // media
  ".mp3", ".wav", ".flac", ".ogg", ".mp4", ".mov", ".avi", ".mkv", ".webm",
  // archives / binaries
  ".zip", ".gz", ".tar", ".tgz", ".rar", ".7z", ".pdf", ".wasm", ".node",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".woff", ".woff2", ".ttf", ".otf",
];

/** Fully-resolved, defaulted options used internally by the watcher core. */
export interface ResolvedOptions {
  readonly recursive: boolean;
  readonly debounce: number;
  readonly batch: number;
  readonly gitignore: boolean;
  readonly awaitWrite: false | AwaitWriteOptions;
  readonly followSymlinks: boolean;
  readonly ignoreInitial: boolean;
  readonly cwd: string;
  /** Time window (ms) to pair delete+create into a move. */
  readonly moveWindow: number;
  /** Flush debounce/batch buffers on close instead of dropping them. */
  readonly flushOnClose: boolean;
  /** Use the polling backend instead of native fs.watch. */
  readonly usePolling: boolean;
  /** Poll interval (ms) for the polling backend. */
  readonly interval: number;
  /** Poll interval (ms) for binary files under the polling backend. */
  readonly binaryInterval: number;
  /** Normalized set of extensions treated as binary for `binaryInterval`. */
  readonly binaryExtensions: Set<string>;
  /** Max recursion depth relative to the watched root (`Infinity` = unlimited). */
  readonly depth: number;
  /** Max async-iterator buffer size before dropping oldest (`0` = unbounded). */
  readonly maxBufferedEvents: number;
  /** Compare a content hash to detect same-size/mtime/ctime edits. */
  readonly hashChanges: boolean;
  readonly raw: WatchOptions;
}

/**
 * Coerce a user-supplied numeric option to a finite number, falling back to
 * `fallback` for `undefined`, `null`, `NaN`, and `±Infinity`. Guards against a
 * misconfigured value (often arriving via JSON/env parsing, which TypeScript
 * cannot catch) silently spinning the CPU or dropping every event downstream.
 */
function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Apply documented defaults to user-supplied options. */
export function resolveOptions(options: WatchOptions, cwd: string): ResolvedOptions {
  const awaitWrite =
    options.awaitWrite === true
      ? {}
      : options.awaitWrite === false || options.awaitWrite === undefined
        ? false
        : options.awaitWrite;

  const interval = Math.max(1, finiteOr(options.interval, 500));

  return {
    recursive: options.recursive ?? true,
    debounce: Math.max(0, finiteOr(options.debounce, 0)),
    batch: Math.max(0, finiteOr(options.batch, 0)),
    gitignore: options.gitignore ?? false,
    awaitWrite,
    followSymlinks: options.followSymlinks ?? false,
    ignoreInitial: options.ignoreInitial ?? false,
    cwd: options.cwd ?? cwd,
    moveWindow: Math.max(0, finiteOr(options.moveWindow, 100)),
    flushOnClose: options.flushOnClose ?? false,
    usePolling: options.usePolling ?? false,
    interval,
    binaryInterval: Math.max(1, finiteOr(options.binaryInterval, interval)),
    binaryExtensions: new Set(
      (options.binaryExtensions ?? DEFAULT_BINARY_EXTENSIONS).map(normalizeExtension),
    ),
    // `depth` is unlimited by default; a non-finite value (NaN/Infinity) means
    // "unlimited" rather than 0 (which would silently drop every event).
    depth: options.depth === undefined ? Infinity : Math.max(0, finiteOr(options.depth, Infinity)),
    maxBufferedEvents: Math.max(0, finiteOr(options.maxBufferedEvents, 0)),
    hashChanges: options.hashChanges ?? false,
    raw: options,
  };
}

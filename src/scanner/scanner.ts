import fs from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";
import type { IgnoreEngine } from "../ignore/ignore-engine.js";

/** A single known filesystem entry, as tracked by the watcher. */
export interface FsEntry {
  readonly absolutePath: string;
  readonly isDirectory: boolean;
  /** inode number, used for move detection (0 when unavailable). */
  readonly ino: number;
  /** device id; paired with `ino` it is the entry's cross-mount identity. */
  readonly dev: number;
  readonly size: number;
  readonly mtimeMs: number;
  /** inode change time — advances on content edits even when size/mtime don't. */
  readonly ctimeMs: number;
  /** Content hash, populated only when `hashChanges` is enabled. */
  readonly hash?: string;
}

export interface ScanOptions {
  readonly recursive: boolean;
  readonly followSymlinks: boolean;
  /**
   * Max depth to descend, where the root's direct entries are depth 0.
   * `Infinity` (default) descends without limit.
   */
  readonly maxDepth?: number;
}

/**
 * A scanned entry plus its raw `Stats`. The `stats` is transient — used to
 * populate initial `create` events during seeding and then discarded, so the
 * long-lived snapshot keeps storing only the lightweight `FsEntry`.
 */
export interface ScannedEntry {
  readonly entry: FsEntry;
  readonly stats: Stats;
}

/** Build an {@link FsEntry} from a stat result. */
export function toEntry(absolutePath: string, stats: Stats): FsEntry {
  return {
    absolutePath,
    isDirectory: stats.isDirectory(),
    ino: Number(stats.ino),
    dev: Number(stats.dev),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}

/**
 * Max `stat` calls in flight per directory. The libuv threadpool (default 4,
 * raise with `UV_THREADPOOL_SIZE`) is the real ceiling on concurrent fs syscalls;
 * this just keeps the pipeline full without letting a huge directory queue an
 * unbounded burst of pending requests.
 */
const SCAN_CONCURRENCY = 64;

/**
 * Walk `root` and return a snapshot of every non-ignored entry, keyed by
 * absolute path. Directories are visited before their children so nested
 * `.gitignore` files are loaded in time to filter siblings.
 *
 * Errors on individual entries (e.g. `EACCES`) are reported via `onError` and
 * skipped — a scan never rejects for a recoverable permission problem.
 */
export async function scan(
  root: string,
  options: ScanOptions,
  ignore: IgnoreEngine,
  onError: (error: Error) => void,
): Promise<Map<string, ScannedEntry>> {
  const entries = new Map<string, ScannedEntry>();
  const rootStats = await safeStat(root, onError);
  if (!rootStats) return entries;

  if (!rootStats.isDirectory()) {
    entries.set(root, { entry: toEntry(root, rootStats), stats: rootStats });
    return entries;
  }

  const maxDepth = options.maxDepth ?? Infinity;
  // Each frame carries the depth of the entries *inside* that directory (root's
  // direct children are depth 0).
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const visited = new Set<string>();
  // Identity of every directory descended into, so a symlink (or hardlink) that
  // loops back into the tree is walked at most once — no infinite recursion.
  const visitedInodes = new Set<string>();
  await visitDir(visitedInodes, root, rootStats, options.followSymlinks, onError);

  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (visited.has(dir)) continue;
    visited.add(dir);

    ignore.loadNestedGitignore(dir);
    const dirents = await safeReadDir(dir, onError);
    if (!dirents) continue;

    // Stat every entry concurrently (bounded), then apply the results in
    // dirent order. Stats are the scan's dominant cost and are independent, so
    // we let the libuv threadpool run them in parallel — but the ordering of
    // `entries`, gitignore, and cycle detection stays identical to a serial walk.
    const abses = dirents.map((dirent) => path.join(dir, dirent.name));
    const statsList = await mapConcurrent(dirents, SCAN_CONCURRENCY, (dirent, i) =>
      resolveStats(abses[i]!, dirent, options.followSymlinks, onError),
    );

    for (let i = 0; i < dirents.length; i++) {
      const stats = statsList[i];
      if (!stats) continue;
      const abs = abses[i]!;

      if (stats.isDirectory()) {
        if (ignore.ignoresDirectory(abs)) continue;
        entries.set(abs, { entry: toEntry(abs, stats), stats });
        // Descend only while the children we'd find stay within maxDepth.
        if (options.recursive && depth < maxDepth) {
          if (await visitDir(visitedInodes, abs, stats, options.followSymlinks, onError)) {
            continue; // already-seen identity: a symlink/hardlink cycle
          }
          stack.push({ dir: abs, depth: depth + 1 });
        }
      } else if (stats.isFile()) {
        if (ignore.ignoresFile(abs)) continue;
        entries.set(abs, { entry: toEntry(abs, stats), stats });
      }
    }
  }

  return entries;
}

/** Stable identity of a directory across symlinks: device id + inode number. */
function inodeKey(stats: Stats): string {
  return `${stats.dev}:${stats.ino}`;
}

/**
 * Record a directory's identity in `seen`; return `true` if it was already
 * present (a cycle, skip it). Uses `dev:ino` normally. When the filesystem
 * reports no usable inode (`0`, e.g. some SMB/FUSE/Windows shares), `dev:ino`
 * would collapse every directory onto `dev:0` and drop the whole tree — so:
 *   - while following symlinks, fall back to the canonical realpath, which
 *     still bounds a symlink cycle (the only way an ino-less walk can loop);
 *   - otherwise skip dedup entirely, since real directories cannot cycle.
 */
async function visitDir(
  seen: Set<string>,
  abs: string,
  stats: Stats,
  followSymlinks: boolean,
  onError: (e: Error) => void,
): Promise<boolean> {
  let key: string;
  if (stats.ino !== 0) {
    key = inodeKey(stats);
  } else if (followSymlinks) {
    key = (await safeRealpath(abs, onError)) ?? abs;
  } else {
    return false;
  }
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}

async function safeRealpath(p: string, onError: (e: Error) => void): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch (error) {
    reportIfUnexpected(error, onError);
    return null;
  }
}

async function resolveStats(
  abs: string,
  dirent: { isSymbolicLink(): boolean },
  followSymlinks: boolean,
  onError: (error: Error) => void,
): Promise<Stats | null> {
  if (dirent.isSymbolicLink()) {
    if (!followSymlinks) return null;
    return safeStat(abs, onError); // stat follows the link
  }
  return safeLstat(abs, onError);
}

async function safeStat(p: string, onError: (e: Error) => void): Promise<Stats | null> {
  try {
    return await fs.stat(p);
  } catch (error) {
    reportIfUnexpected(error, onError);
    return null;
  }
}

async function safeLstat(p: string, onError: (e: Error) => void): Promise<Stats | null> {
  try {
    return await fs.lstat(p);
  } catch (error) {
    reportIfUnexpected(error, onError);
    return null;
  }
}

async function safeReadDir(
  dir: string,
  onError: (e: Error) => void,
): Promise<import("node:fs").Dirent[] | null> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    reportIfUnexpected(error, onError);
    return null;
  }
}

/**
 * Map `items` through `fn` with at most `limit` calls in flight, preserving
 * input order in the result. Single-threaded JS makes the `next++` cursor
 * race-free: there is no `await` between reading and incrementing it.
 */
async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function reportIfUnexpected(error: unknown, onError: (e: Error) => void): void {
  const code = (error as NodeJS.ErrnoException).code;
  // These are expected during racy walks and are not surfaced.
  if (code === "ENOENT" || code === "ENOTDIR") return;
  onError(error as Error);
}

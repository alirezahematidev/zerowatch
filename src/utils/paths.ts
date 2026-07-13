import path from "node:path";

/**
 * Normalize a path to use forward slashes regardless of platform. Glob matching
 * and ignore rules operate exclusively on POSIX-style paths so that a single
 * pattern behaves identically on Windows and Unix.
 */
export function toPosix(p: string): string {
  // On POSIX the separator is already "/", so skip the split/join allocation on
  // this hot path (called per event). Only Windows needs the conversion.
  return path.sep === "/" ? p : p.split(path.sep).join("/");
}

/** Resolve `target` against `cwd` into an absolute path. */
export function resolveAbsolute(cwd: string, target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(cwd, target);
}

/**
 * Compute the path of `absolutePath` relative to `root`, always using POSIX
 * separators. When the two are equal, the basename is returned so events for
 * the watched root itself still carry a meaningful relative path.
 */
export function relativeTo(root: string, absolutePath: string): string {
  const rel = path.relative(root, absolutePath);
  if (rel === "") return toPosix(path.basename(absolutePath));
  return toPosix(rel);
}

/** Normalize an extension to a leading-dot, lowercase form (`"TS"` -> `".ts"`). */
export function normalizeExtension(ext: string): string {
  const withDot = ext.startsWith(".") ? ext : `.${ext}`;
  return withDot.toLowerCase();
}

/** Lowercase file extension of a path, including the dot (`""` when none). */
export function extname(p: string): string {
  return path.extname(p).toLowerCase();
}

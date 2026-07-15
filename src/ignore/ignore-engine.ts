import path from "node:path";
import type { IgnoreFunction, IgnoreInput, WatchOptions } from "../types/options.js";
import { compileGlob, type GlobMatcher } from "./glob.js";
import {
  GitignoreSet,
  loadRootGitignore,
  addNestedGitignore,
} from "./gitignore.js";
import { extname, normalizeExtension, relativeTo, toPosix } from "../utils/paths.js";
import { caseInsensitiveFs } from "../platform/capabilities.js";

/**
 * Central decision point for "should this path be watched / reported?".
 *
 * Combines, in order of evaluation:
 *   1. user glob patterns          (ignore: ["**\/*.log"])
 *   2. user predicate functions    (ignore: (abs, rel) => boolean)
 *   3. `.gitignore` rules           (gitignore: true)
 *   4. extension allow-list         (extensions: [".ts"])
 *
 * The engine is deliberately pure and synchronous so it can be called on the
 * hot path for every raw event without allocation surprises.
 */
export class IgnoreEngine {
  readonly #root: string;
  readonly #globs: GlobMatcher[];
  readonly #predicates: IgnoreFunction[];
  readonly #gitignore: GitignoreSet | null;
  readonly #extensions: Set<string> | null;
  /** Memoizes whether a directory (by absolute path) lies under an ignored ancestor. */
  readonly #ancestorCache = new Map<string, boolean>();

  private constructor(
    root: string,
    globs: GlobMatcher[],
    predicates: IgnoreFunction[],
    gitignore: GitignoreSet | null,
    extensions: Set<string> | null,
  ) {
    this.#root = root;
    this.#globs = globs;
    this.#predicates = predicates;
    this.#gitignore = gitignore;
    this.#extensions = extensions;
  }

  /** Build an engine from resolved options and the absolute watched root. */
  static create(root: string, options: WatchOptions): IgnoreEngine {
    const { globs, predicates } = splitIgnoreInput(options.ignore);
    const gitignore = options.gitignore ? loadRootGitignore(root, caseInsensitiveFs) : null;
    const extensions =
      options.extensions && options.extensions.length > 0
        ? new Set(options.extensions.map(normalizeExtension))
        : null;
    return new IgnoreEngine(root, globs, predicates, gitignore, extensions);
  }

  /** Merge a nested `.gitignore` (discovered while scanning) into the engine. */
  loadNestedGitignore(dirAbsolute: string): void {
    if (this.#gitignore) {
      addNestedGitignore(this.#gitignore, this.#root, dirAbsolute);
      // New rules may change ancestor decisions; invalidate the memo.
      this.#ancestorCache.clear();
    }
  }

  /**
   * Should traversal descend into / keep watching this directory? Applies every
   * rule except the extension allow-list (directories have no extension and
   * pruning them would break recursion).
   */
  ignoresDirectory(absolutePath: string): boolean {
    const rel = relativeTo(this.#root, absolutePath);
    if (this.#matchesIgnoreRules(absolutePath, rel, true)) return true;
    return this.#ancestorIgnored(absolutePath);
  }

  /**
   * Should an event for this file be suppressed? Applies all rules including the
   * extension allow-list.
   */
  ignoresFile(absolutePath: string): boolean {
    const rel = relativeTo(this.#root, absolutePath);
    if (this.#matchesIgnoreRules(absolutePath, rel, false)) return true;
    if (this.#extensions && !this.#extensions.has(extname(absolutePath))) return true;
    return this.#ancestorIgnored(absolutePath);
  }

  /**
   * True when any ancestor directory (between `absolutePath` and the watched
   * root) is itself ignored. This is what makes a bare pattern like
   * `ignore: ["node_modules"]` suppress the *whole* subtree consistently across
   * platforms: on Linux the manual watcher never descends into a pruned dir, but
   * native recursive watchers (macOS/Windows) report every descendant, so the
   * core must reject descendants of an ignored directory explicitly.
   */
  #ancestorIgnored(absolutePath: string): boolean {
    const dir = path.dirname(absolutePath);
    const rel = path.relative(this.#root, dir);
    // Reached (or climbed above) the watched root — nothing more to check.
    if (rel === "" || rel === "." || rel.startsWith("..")) return false;

    const cached = this.#ancestorCache.get(dir);
    if (cached !== undefined) return cached;

    const ignored =
      this.#matchesIgnoreRules(dir, toPosix(rel), true) || this.#ancestorIgnored(dir);
    this.#ancestorCache.set(dir, ignored);
    return ignored;
  }

  /**
   * For directories we also test a sentinel child path so that subtree patterns
   * like `**\/dist/**` prune the `dist` directory itself (and stop traversal),
   * not merely its contents. The sentinel `\0` can never appear in a real path
   * segment, so this never over-matches a segment pattern such as `*.log`.
   */
  #matchesIgnoreRules(absolutePath: string, rel: string, isDirectory: boolean): boolean {
    const posix = toPosix(rel);
    // Globs are compiled to match POSIX (`/`-separated) paths, so the absolute
    // candidates must be normalized too — otherwise on Windows a backslash
    // absolute path can never match a `/`-based absolute glob. No-op on POSIX.
    const posixAbs = toPosix(absolutePath);
    const posixCandidates = isDirectory ? [posix, `${posix}/\0`] : [posix];
    const absCandidates = isDirectory ? [posixAbs, `${posixAbs}/\0`] : [posixAbs];

    for (const glob of this.#globs) {
      if (posixCandidates.some((c) => glob.test(c))) return true;
      if (absCandidates.some((c) => glob.test(c))) return true;
    }
    for (const predicate of this.#predicates) {
      if (predicate(absolutePath, posix)) return true;
    }
    if (this.#gitignore && !this.#gitignore.isEmpty) {
      if (posixCandidates.some((c) => this.#gitignore!.ignores(c))) return true;
    }
    return false;
  }
}

function splitIgnoreInput(input: IgnoreInput | undefined): {
  globs: GlobMatcher[];
  predicates: IgnoreFunction[];
} {
  const globs: GlobMatcher[] = [];
  const predicates: IgnoreFunction[] = [];
  if (input === undefined) return { globs, predicates };

  const items = Array.isArray(input) ? input : [input];
  for (const item of items) {
    if (typeof item === "function") predicates.push(item);
    else globs.push(compileGlob(item, { caseInsensitive: caseInsensitiveFs }));
  }
  return { globs, predicates };
}

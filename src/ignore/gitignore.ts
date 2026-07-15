import fs from "node:fs";
import path from "node:path";
import { compileGlob, type GlobMatcher } from "./glob.js";
import { toPosix } from "../utils/paths.js";

/**
 * A single compiled `.gitignore` rule. `negated` rules (`!pattern`) re-include
 * paths that earlier rules excluded; the last matching rule wins, matching
 * git's own semantics.
 */
interface GitignoreRule {
  readonly negated: boolean;
  readonly matchers: GlobMatcher[];
}

export class GitignoreSet {
  readonly #rules: GitignoreRule[] = [];
  readonly #caseInsensitive: boolean;

  constructor(caseInsensitive = false) {
    this.#caseInsensitive = caseInsensitive;
  }

  /** True when at least one rule has been loaded. */
  get isEmpty(): boolean {
    return this.#rules.length === 0;
  }

  /**
   * Parse the contents of a `.gitignore` file located `baseRelDir` (POSIX,
   * relative to the watched root) below the root. Rules are appended so that
   * files loaded later (deeper) take precedence, as git evaluates them.
   */
  add(contents: string, baseRelDir: string): void {
    for (const raw of contents.split(/\r?\n/)) {
      const rule = parseLine(raw, baseRelDir, this.#caseInsensitive);
      if (rule) this.#rules.push(rule);
    }
  }

  /**
   * Decide whether `relPosixPath` (relative to the watched root) is ignored.
   * Evaluates all rules in order; the final match determines the outcome.
   */
  ignores(relPosixPath: string): boolean {
    let ignored = false;
    for (const rule of this.#rules) {
      if (rule.matchers.some((m) => m.test(relPosixPath))) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

function parseLine(raw: string, baseRelDir: string, caseInsensitive: boolean): GitignoreRule | null {
  let line = raw;
  // Strip un-escaped trailing whitespace.
  line = line.replace(/(?<!\\)\s+$/, "");
  if (line === "" || line.startsWith("#")) return null;

  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1);
  }
  // Unescape leading `\#` / `\!`.
  line = line.replace(/^\\([#!])/, "$1");

  const directoryOnly = line.endsWith("/");
  if (directoryOnly) line = line.slice(0, -1);

  const anchored = line.startsWith("/") || line.slice(0, -1).includes("/");
  if (line.startsWith("/")) line = line.slice(1);

  // Prefix with the gitignore's own directory so nested gitignores only affect
  // their subtree.
  const prefix = baseRelDir === "" ? "" : `${baseRelDir}/`;
  const core = anchored ? `${prefix}${line}` : `${prefix}**/${line}`;

  const patterns = directoryOnly ? [`${core}/**`] : [core, `${core}/**`];
  return {
    negated,
    matchers: patterns.map((p) => compileGlob(p, { caseInsensitive })),
  };
}

/**
 * Walk from the watched root loading every `.gitignore` encountered, shallow
 * first, so deeper files override shallower ones. Only the root file is loaded
 * eagerly here; nested files are discovered lazily by the scanner as it walks.
 */
export function loadRootGitignore(root: string, caseInsensitive = false): GitignoreSet {
  const set = new GitignoreSet(caseInsensitive);
  const file = path.join(root, ".gitignore");
  try {
    const contents = fs.readFileSync(file, "utf8");
    set.add(contents, "");
  } catch {
    // No root .gitignore is perfectly normal.
  }
  return set;
}

/** Load a nested `.gitignore` into an existing set, keyed by its directory. */
export function addNestedGitignore(
  set: GitignoreSet,
  root: string,
  dirAbsolute: string,
): void {
  const file = path.join(dirAbsolute, ".gitignore");
  try {
    const contents = fs.readFileSync(file, "utf8");
    const relDir = toPosix(path.relative(root, dirAbsolute));
    set.add(contents, relDir);
  } catch {
    // Not every directory has one.
  }
}

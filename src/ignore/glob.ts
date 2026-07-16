/**
 * A minimal, dependency-free glob-to-RegExp compiler supporting the subset of
 * glob syntax relevant to ignore rules:
 *
 *   `*`   — matches any run of characters except `/`
 *   `**`  — matches any run of characters including `/` (crosses directories)
 *   `?`   — matches a single character except `/`
 *   `[…]` — a character class, with `[!…]` / `[^…]` negation
 *   `{a,b}` — brace alternation
 *
 * Patterns operate on POSIX-style paths (see {@link toPosix}). A trailing `/`
 * on a pattern matches a directory and everything beneath it.
 */
export interface GlobMatcher {
  readonly source: string;
  test(posixPath: string): boolean;
}

const REGEX_SPECIAL = /[.+^${}()|\\]/;

function escapeLiteral(char: string): string {
  return REGEX_SPECIAL.test(char) ? `\\${char}` : char;
}

/** Options controlling how a glob is compiled. */
export interface CompileGlobOptions {
  /** Match case-insensitively (adds the `i` flag). Default: `false`. */
  readonly caseInsensitive?: boolean;
}

/** Compile a single glob pattern into a matcher. */
export function compileGlob(pattern: string, options: CompileGlobOptions = {}): GlobMatcher {
  const flags = options.caseInsensitive ? "i" : "";
  const source = globToRegExpSource(pattern);
  let regex: RegExp;
  try {
    regex = new RegExp(`^${source}$`, flags);
  } catch {
    // A malformed pattern (e.g. an invalid character-class range like `[z-a]`
    // or `[a-Z]`) must never crash watcher startup — the compile path runs
    // outside the core's try/catch, so a throw here surfaces as an unhandled
    // rejection. Fall back to matching the pattern as a literal string, which
    // is well-defined and inert for real paths rather than crashing.
    const literal = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(`^${literal}$`, flags);
  }
  return {
    source: pattern,
    test: (posixPath: string) => regex.test(posixPath),
  };
}

function globToRegExpSource(pattern: string): string {
  let normalized = pattern;
  // A trailing slash (dir marker) also matches everything inside the dir.
  if (normalized.endsWith("/")) normalized = `${normalized}**`;
  // Collapse consecutive globstar segments (`**/**` -> `**`) so a run of them
  // compiles to a single group instead of many adjacent `(?:.*/)?`, which
  // backtrack catastrophically (ReDoS). Semantically identical: "any dirs /
  // any dirs" is just "any dirs".
  while (normalized.includes("**/**")) {
    normalized = normalized.replace(/\*\*\/\*\*/g, "**");
  }

  let out = "";
  const chars = [...normalized];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;

    if (char === "*") {
      // Consume the entire run of consecutive `*` at once. A run of two or more
      // that forms a whole path segment (bounded by `/` or the pattern edges)
      // is a globstar and crosses directories; anything else — a lone `*`, or
      // stars glued to other characters like `a**b` — degrades to a single
      // `[^/]*`. Collapsing the run to ONE quantifier is what prevents the
      // adjacent-`[^/]*` catastrophic backtracking.
      let runEnd = i;
      while (chars[runEnd + 1] === "*") runEnd++;
      const starCount = runEnd - i + 1;
      const prev = chars[i - 1];
      const afterRun = chars[runEnd + 1];
      const isGlobstar =
        starCount >= 2 &&
        (prev === undefined || prev === "/") &&
        (afterRun === undefined || afterRun === "/");
      i = runEnd;
      if (isGlobstar) {
        // Consume an optional following slash so `**/foo` also matches a
        // top-level `foo`.
        if (chars[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      out += "[^/]";
      continue;
    }

    if (char === "[") {
      const closed = compileClass(chars, i);
      if (closed) {
        out += closed.source;
        i = closed.endIndex;
        continue;
      }
      out += "\\[";
      continue;
    }

    if (char === "{") {
      const closed = compileBraces(chars, i);
      if (closed) {
        out += closed.source;
        i = closed.endIndex;
        continue;
      }
      out += "\\{";
      continue;
    }

    out += escapeLiteral(char);
  }
  return out;
}

function compileClass(
  chars: string[],
  start: number,
): { source: string; endIndex: number } | null {
  let j = start + 1;
  let negate = false;
  if (chars[j] === "!" || chars[j] === "^") {
    negate = true;
    j++;
  }
  let body = "";
  let closed = false;
  for (; j < chars.length; j++) {
    const c = chars[j]!;
    if (c === "\\") {
      // Escaped member: take the next char literally, so `\]` is a literal `]`
      // rather than the class terminator.
      const escaped = chars[j + 1];
      if (escaped === undefined) {
        body += "\\\\";
        continue;
      }
      j++;
      if (escaped === "/") continue; // a class never matches the path separator
      body +=
        escaped === "]" || escaped === "\\" || escaped === "^" || escaped === "-"
          ? `\\${escaped}`
          : escaped;
      continue;
    }
    if (c === "]") {
      closed = true;
      break;
    }
    // A glob character class can never match the path separator.
    if (c === "/") continue;
    body += c;
  }
  if (!closed || body === "") return null;
  return { source: `[${negate ? "^" : ""}${body}]`, endIndex: j };
}

function compileBraces(
  chars: string[],
  start: number,
): { source: string; endIndex: number } | null {
  // Find the matching close brace, tracking nesting depth.
  let depth = 0;
  let end = -1;
  for (let j = start; j < chars.length; j++) {
    if (chars[j] === "{") depth++;
    else if (chars[j] === "}") {
      depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
  }
  if (end === -1) return null; // unbalanced

  // Split the body on top-level commas only, so `{a,{b,c}}` keeps its nesting.
  const alternatives: string[] = [];
  let current = "";
  let inner = 0;
  for (let j = start + 1; j < end; j++) {
    const c = chars[j]!;
    if (c === "{") inner++;
    else if (c === "}") inner--;
    if (c === "," && inner === 0) {
      alternatives.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  alternatives.push(current);

  const source = alternatives.map((alt) => globToRegExpSource(alt)).join("|");
  return { source: `(?:${source})`, endIndex: end };
}

/** Glob metacharacters that distinguish a pattern from a literal path. */
const GLOB_METACHARS = /[*?[\]{}]/;

/** True when `input` contains any glob metacharacter (`* ? [ ] { }`). */
export function isGlob(input: string): boolean {
  return GLOB_METACHARS.test(input);
}

/**
 * Split a glob pattern into its static base directory — the leading run of
 * segments containing no glob metacharacter — and the original pattern.
 * Separators (`/` or `\`) are both recognized; the returned `base` is POSIX
 * (`/`-joined) and safe to pass to `path.resolve`.
 *
 *   "src/**\/*.ts"     -> { base: "src",        pattern: "src/**\/*.ts" }
 *   "assets/img/*.png" -> { base: "assets/img", pattern: "assets/img/*.png" }
 *   "**\/*.ts"         -> { base: "",           pattern: "**\/*.ts" }
 */
export function splitGlobBase(pattern: string): { base: string; pattern: string } {
  const segments = pattern.split(/[\\/]/);
  const baseSegments: string[] = [];
  for (const segment of segments) {
    if (isGlob(segment)) break;
    baseSegments.push(segment);
  }
  return { base: baseSegments.join("/"), pattern };
}

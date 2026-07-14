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

/** Compile a single glob pattern into a matcher. */
export function compileGlob(pattern: string): GlobMatcher {
  const source = globToRegExpSource(pattern);
  const regex = new RegExp(`^${source}$`);
  return {
    source: pattern,
    test: (posixPath: string) => regex.test(posixPath),
  };
}

function globToRegExpSource(pattern: string): string {
  let normalized = pattern;
  // A trailing slash (dir marker) also matches everything inside the dir.
  if (normalized.endsWith("/")) normalized = `${normalized}**`;

  let out = "";
  const chars = [...normalized];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const next = chars[i + 1];

    if (char === "*") {
      // `**` is special (crosses directories) only as a *whole* path segment —
      // bounded by `/` or the pattern's edges on both sides. Glued to other
      // characters (e.g. `a**b`) it degrades to a regular `*` per glob spec.
      const prev = chars[i - 1];
      const afterPair = chars[i + 2];
      const isSegmentGlobstar =
        next === "*" &&
        (prev === undefined || prev === "/") &&
        (afterPair === undefined || afterPair === "/");
      if (isSegmentGlobstar) {
        // Consume the pair and an optional following slash so that `**/foo`
        // also matches a top-level `foo`.
        i++;
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

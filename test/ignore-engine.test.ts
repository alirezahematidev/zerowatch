import { describe, it, expect } from "vitest";
import path from "node:path";
import { IgnoreEngine } from "../src/ignore/ignore-engine.js";

const root = path.resolve("/watch/root");
const p = (...parts: string[]) => path.join(root, ...parts);

describe("IgnoreEngine ancestor suppression (cross-platform consistency)", () => {
  it("suppresses descendants of a bare-pattern ignored directory", () => {
    // A native recursive watcher (macOS/Windows) reports every descendant, so
    // the engine must reject files *inside* an ignored dir, not only the dir.
    const eng = IgnoreEngine.create(root, { ignore: ["node_modules"] });
    expect(eng.ignoresDirectory(p("node_modules"))).toBe(true);
    expect(eng.ignoresFile(p("node_modules", "pkg", "index.js"))).toBe(true);
    expect(eng.ignoresDirectory(p("node_modules", "pkg"))).toBe(true);
    // Siblings are unaffected.
    expect(eng.ignoresFile(p("src", "app.ts"))).toBe(false);
  });

  it("suppresses descendants matched by an ignore predicate on the dir", () => {
    const eng = IgnoreEngine.create(root, {
      ignore: (_abs, rel) => rel === "build",
    });
    expect(eng.ignoresDirectory(p("build"))).toBe(true);
    expect(eng.ignoresFile(p("build", "out.js"))).toBe(true);
    expect(eng.ignoresFile(p("buildtools", "keep.js"))).toBe(false);
  });

  it("does not over-suppress when no ancestor is ignored", () => {
    const eng = IgnoreEngine.create(root, { ignore: ["**/*.log"] });
    expect(eng.ignoresFile(p("a", "b", "c.txt"))).toBe(false);
    expect(eng.ignoresFile(p("a", "b", "c.log"))).toBe(true);
  });
});

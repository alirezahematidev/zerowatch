import { describe, it, expect } from "vitest";
import path from "node:path";
import { IgnoreEngine } from "../src/ignore/ignore-engine.js";
import { compileGlob } from "../src/ignore/glob.js";
import { toPosix } from "../src/utils/paths.js";
import { caseInsensitiveFs } from "../src/platform/capabilities.js";

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

describe("IgnoreEngine scope allow-list (glob watch targets)", () => {
  const ci = { caseInsensitive: caseInsensitiveFs };
  const tsScope = () => [compileGlob(`${toPosix(p("src"))}/**/*.ts`, ci)];

  it("emits only in-scope files; directories always pass for traversal", () => {
    const eng = IgnoreEngine.create(root, {}, tsScope(), true);
    expect(eng.ignoresFile(p("src", "a.ts"))).toBe(false);
    expect(eng.ignoresFile(p("src", "deep", "b.ts"))).toBe(false);
    expect(eng.ignoresFile(p("src", "a.js"))).toBe(true); // out of scope
    expect(eng.ignoresFile(p("other", "a.ts"))).toBe(true); // outside the base
    expect(eng.ignoresDirectory(p("src", "deep"))).toBe(false); // dirs unaffected
  });

  it("does not enforce scope when inactive", () => {
    const eng = IgnoreEngine.create(root, {}, tsScope(), false);
    expect(eng.ignoresFile(p("src", "a.js"))).toBe(false);
    expect(eng.ignoresFile(p("any", "thing.png"))).toBe(false);
  });

  it("extendScope activates and grows the allow-list", () => {
    const eng = IgnoreEngine.create(root, {});
    expect(eng.ignoresFile(p("lib", "x.js"))).toBe(false); // inactive: allowed
    eng.extendScope([compileGlob(`${toPosix(p("lib"))}/**/*.ts`, ci)], true);
    expect(eng.ignoresFile(p("lib", "x.ts"))).toBe(false);
    expect(eng.ignoresFile(p("lib", "x.js"))).toBe(true); // now enforced
  });
});

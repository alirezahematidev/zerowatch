import { describe, it, expect } from "vitest";
import { compileGlob } from "../src/ignore/glob.js";

describe("compileGlob", () => {
  it("matches a single-segment wildcard without crossing slashes", () => {
    const m = compileGlob("*.log");
    expect(m.test("error.log")).toBe(true);
    expect(m.test("nested/error.log")).toBe(false);
  });

  it("matches globstar across directories", () => {
    const m = compileGlob("**/*.log");
    expect(m.test("error.log")).toBe(true);
    expect(m.test("a/b/c/error.log")).toBe(true);
    expect(m.test("error.txt")).toBe(false);
  });

  it("matches a directory subtree", () => {
    const m = compileGlob("**/dist/**");
    expect(m.test("dist/index.js")).toBe(true);
    expect(m.test("pkg/dist/deep/index.js")).toBe(true);
    expect(m.test("src/index.js")).toBe(false);
  });

  it("supports ? and character classes", () => {
    expect(compileGlob("file?.ts").test("file1.ts")).toBe(true);
    expect(compileGlob("file?.ts").test("file12.ts")).toBe(false);
    expect(compileGlob("[abc].ts").test("a.ts")).toBe(true);
    expect(compileGlob("[!abc].ts").test("a.ts")).toBe(false);
    expect(compileGlob("[!abc].ts").test("d.ts")).toBe(true);
  });

  it("supports brace alternation", () => {
    const m = compileGlob("**/*.{ts,tsx}");
    expect(m.test("src/a.ts")).toBe(true);
    expect(m.test("src/a.tsx")).toBe(true);
    expect(m.test("src/a.js")).toBe(false);
  });

  it("supports nested brace alternation", () => {
    const m = compileGlob("**/*.{ts,{js,mjs}}");
    expect(m.test("src/a.ts")).toBe(true);
    expect(m.test("src/a.js")).toBe(true);
    expect(m.test("src/a.mjs")).toBe(true);
    expect(m.test("src/a.tsx")).toBe(false);
  });

  it("treats an unbalanced brace as a literal", () => {
    const m = compileGlob("a{b.ts");
    expect(m.test("a{b.ts")).toBe(true);
  });

  it("escapes regex-special literal characters", () => {
    const m = compileGlob("a.b+c(d).ts");
    expect(m.test("a.b+c(d).ts")).toBe(true);
    expect(m.test("aXbXcXdX.ts")).toBe(false);
  });
});

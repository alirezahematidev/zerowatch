import { describe, it, expect } from "vitest";
import { compileGlob, isGlob, splitGlobBase } from "../src/ignore/glob.js";

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

  it("does not let ** cross a slash unless it is a whole path segment", () => {
    // `a**b` is not a full `**` segment, so it behaves like `a*b` (no slash).
    const m = compileGlob("a**b");
    expect(m.test("axyzb")).toBe(true);
    expect(m.test("ax/yb")).toBe(false);
  });

  it("honors an escaped ] inside a character class", () => {
    const m = compileGlob("file[a\\]b].txt");
    expect(m.test("filea.txt")).toBe(true);
    expect(m.test("file].txt")).toBe(true);
    expect(m.test("fileb.txt")).toBe(true);
    expect(m.test("filec.txt")).toBe(false);
  });

  it("never matches a path separator via a character class", () => {
    const m = compileGlob("[a/b]");
    expect(m.test("/")).toBe(false);
  });
});

describe("isGlob", () => {
  it("detects glob metacharacters", () => {
    expect(isGlob("src/**/*.ts")).toBe(true);
    expect(isGlob("a/b?.ts")).toBe(true);
    expect(isGlob("a/[abc].ts")).toBe(true);
    expect(isGlob("a/{x,y}.ts")).toBe(true);
  });
  it("treats plain paths as non-globs", () => {
    expect(isGlob("src/index.ts")).toBe(false);
    expect(isGlob("src")).toBe(false);
    expect(isGlob("")).toBe(false);
  });
});

describe("splitGlobBase", () => {
  it("returns the leading glob-free segments as the base", () => {
    expect(splitGlobBase("src/**/*.ts").base).toBe("src");
    expect(splitGlobBase("assets/img/*.png").base).toBe("assets/img");
  });
  it("returns an empty base when the first segment globs", () => {
    expect(splitGlobBase("**/*.ts").base).toBe("");
    expect(splitGlobBase("*.ts").base).toBe("");
  });
  it("tolerates backslash separators", () => {
    expect(splitGlobBase("src\\**\\*.ts").base).toBe("src");
  });
  it("echoes the original pattern back", () => {
    expect(splitGlobBase("src/**/*.ts").pattern).toBe("src/**/*.ts");
  });
});

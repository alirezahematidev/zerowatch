import { describe, it, expect } from "vitest";
import { GitignoreSet } from "../src/ignore/gitignore.js";

describe("GitignoreSet", () => {
  it("ignores simple patterns anywhere in the tree", () => {
    const set = new GitignoreSet();
    set.add("*.log\nnode_modules/\n", "");
    expect(set.ignores("error.log")).toBe(true);
    expect(set.ignores("deep/nested/error.log")).toBe(true);
    expect(set.ignores("node_modules/pkg/index.js")).toBe(true);
    expect(set.ignores("src/index.ts")).toBe(false);
  });

  it("anchors patterns that contain a slash", () => {
    const set = new GitignoreSet();
    set.add("/dist\nbuild/output\n", "");
    expect(set.ignores("dist/app.js")).toBe(true);
    expect(set.ignores("packages/dist/app.js")).toBe(false);
    expect(set.ignores("build/output/x")).toBe(true);
  });

  it("honors negation with last-match-wins", () => {
    const set = new GitignoreSet();
    set.add("*.log\n!keep.log\n", "");
    expect(set.ignores("a.log")).toBe(true);
    expect(set.ignores("keep.log")).toBe(false);
  });

  it("skips comments and blank lines", () => {
    const set = new GitignoreSet();
    set.add("# a comment\n\n  \n*.tmp\n", "");
    expect(set.ignores("x.tmp")).toBe(true);
    expect(set.isEmpty).toBe(false);
  });

  it("scopes nested gitignores to their directory", () => {
    const set = new GitignoreSet();
    set.add("secret.txt\n", "packages/app");
    expect(set.ignores("packages/app/secret.txt")).toBe(true);
    expect(set.ignores("secret.txt")).toBe(false);
    expect(set.ignores("packages/other/secret.txt")).toBe(false);
  });
});

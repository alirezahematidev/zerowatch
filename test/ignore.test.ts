import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { watch } from "../src/index.js";
import type { WatchEvent } from "../src/index.js";
import { tempDir, sleep, waitFor } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
function makeDir(): string {
  const { dir, cleanup } = tempDir();
  cleanups.push(cleanup);
  return dir;
}

describe("ignore engine (integration)", () => {
  it("ignores glob patterns", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true, ignore: ["**/*.log"] });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.relativePath));
    writeFileSync(join(dir, "keep.txt"), "1");
    writeFileSync(join(dir, "skip.log"), "2");
    await waitFor(() => seen.includes("keep.txt"));
    await sleep(80);

    expect(seen).toContain("keep.txt");
    expect(seen).not.toContain("skip.log");
  });

  it("honors an ignore predicate function", async () => {
    const dir = makeDir();
    const w = watch(dir, {
      ignoreInitial: true,
      ignore: (_abs, rel) => rel.startsWith("secret"),
    });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.relativePath));
    writeFileSync(join(dir, "public.txt"), "1");
    writeFileSync(join(dir, "secret.txt"), "2");
    await waitFor(() => seen.includes("public.txt"));
    await sleep(80);

    expect(seen).toContain("public.txt");
    expect(seen).not.toContain("secret.txt");
  });

  it("filters by extension allow-list", async () => {
    const dir = makeDir();
    const w = watch(dir, { ignoreInitial: true, extensions: [".ts"] });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.relativePath));
    writeFileSync(join(dir, "a.ts"), "1");
    writeFileSync(join(dir, "b.js"), "2");
    await waitFor(() => seen.includes("a.ts"));
    await sleep(80);

    expect(seen).toContain("a.ts");
    expect(seen).not.toContain("b.js");
  });

  it("does not descend into ignored directories", async () => {
    const dir = makeDir();
    const w = watch(dir, {
      ignoreInitial: true,
      ignore: ["**/node_modules/**"],
    });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e) => seen.push(e.relativePath));
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "1");
    writeFileSync(join(dir, "app.js"), "2");
    await waitFor(() => seen.includes("app.js"));
    await sleep(80);

    expect(seen.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("respects .gitignore when enabled", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, ".gitignore"), "*.tmp\n");
    const w = watch(dir, { ignoreInitial: true, gitignore: true });
    cleanups.push(() => void w.close());
    await w.ready();

    const seen: string[] = [];
    w.on("all", (e: WatchEvent) => seen.push(e.relativePath));
    writeFileSync(join(dir, "real.txt"), "1");
    writeFileSync(join(dir, "cache.tmp"), "2");
    await waitFor(() => seen.includes("real.txt"));
    await sleep(80);

    expect(seen).toContain("real.txt");
    expect(seen).not.toContain("cache.tmp");
  });
});

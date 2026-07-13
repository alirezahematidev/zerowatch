/**
 * Startup + throughput benchmarks.
 *
 *   npm run build && node bench/index.ts
 *
 * Benchmarks watchx, and — if `chokidar` happens to be installed — runs the
 * same scenario against it for comparison. chokidar is NOT a dependency; the
 * comparison is skipped silently when it isn't present.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { watch } from "../dist/index.js";

const FILES = 5_000;
const DIRS = 50;
const EDITS = 1_000;

function buildTree(): string {
  const root = mkdtempSync(join(tmpdir(), "watchx-bench-"));
  for (let d = 0; d < DIRS; d++) {
    const dir = join(root, `dir-${d}`);
    mkdirSync(dir);
    for (let f = 0; f < FILES / DIRS; f++) {
      writeFileSync(join(dir, `file-${f}.txt`), `content ${f}`);
    }
  }
  return root;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function benchWatchx(root: string): Promise<void> {
  // Startup: time to `ready` over the whole tree.
  const t0 = performance.now();
  const watcher = watch(root, { recursive: true, ignoreInitial: true });
  await watcher.ready();
  const startup = performance.now() - t0;

  // Throughput: edit EDITS *distinct* files and count delivered events. Time is
  // measured to the last delivered event, excluding the fixed drain wait.
  let received = 0;
  let lastAt = performance.now();
  watcher.on("all", () => {
    received++;
    lastAt = performance.now();
  });

  const tEdit = performance.now();
  editDistinct(root);
  await sleep(1500); // drain
  const elapsed = Math.max(1, lastAt - tEdit);

  await watcher.close();

  report("watchx", startup, received, elapsed);
}

async function benchChokidar(root: string): Promise<void> {
  let chokidar: typeof import("chokidar") | null = null;
  try {
    chokidar = await import("chokidar");
  } catch {
    console.log("\nchokidar not installed — skipping comparison.");
    return;
  }

  const t0 = performance.now();
  const watcher = chokidar.watch(root, { ignoreInitial: true });
  await new Promise<void>((resolve) => watcher.on("ready", () => resolve()));
  const startup = performance.now() - t0;

  let received = 0;
  let lastAt = performance.now();
  watcher.on("all", () => {
    received++;
    lastAt = performance.now();
  });

  const tEdit = performance.now();
  editDistinct(root);
  await sleep(1500);
  const elapsed = Math.max(1, lastAt - tEdit);

  await watcher.close();
  report("chokidar", startup, received, elapsed);
}

/** Edit EDITS distinct files (one write each) to exercise event throughput. */
function editDistinct(root: string): void {
  const perDir = FILES / DIRS;
  for (let i = 0; i < EDITS; i++) {
    const d = i % DIRS;
    const f = Math.floor(i / DIRS) % perDir;
    writeFileSync(join(root, `dir-${d}`, `file-${f}.txt`), `edited ${i} padding-${i}`);
  }
}

function report(name: string, startupMs: number, received: number, elapsedMs: number): void {
  const perSec = Math.round((received / elapsedMs) * 1000);
  console.log(
    `\n${name}\n` +
      `  startup (ready over ${FILES} files): ${startupMs.toFixed(1)} ms\n` +
      `  events delivered (${EDITS} edits):   ${received}\n` +
      `  throughput:                          ${perSec.toLocaleString()} events/s`,
  );
}

async function main(): Promise<void> {
  console.log(`Building tree: ${FILES} files across ${DIRS} dirs …`);
  const root = buildTree();
  try {
    await benchWatchx(root);
    await benchChokidar(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
